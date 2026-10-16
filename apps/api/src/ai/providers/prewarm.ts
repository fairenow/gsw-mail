import { config } from "../../config.js";
import { getAiCapabilitySettings } from "../capabilities.js";

type WarmTarget={url:string;model:string;token:string};
const lastStarted=new Map<string,number>();
const pending=new Set<string>();
const WARM_INTERVAL_MS=10*60_000;

function targetFor(provider:string):WarmTarget|null {
  const token=config.ai.modalProxyToken;
  if(!token)return null;
  if(provider==="gpt-oss-120b" && config.ai.gptOssVllmBaseUrl)
    return {url:config.ai.gptOssVllmBaseUrl,model:"gpt-oss-120b",token};
  if(provider==="qwen-modal" && config.ai.qwen36BaseUrl)
    return {url:config.ai.qwen36BaseUrl,model:"Qwen/Qwen3.6-35B-A3B-FP8",token};
  if(provider==="deepseek-v4.1-flash" && process.env.DEEPSEEK_BASE_URL)
    return {url:process.env.DEEPSEEK_BASE_URL,model:"deepseek-ai/DeepSeek-V4.1-Flash",token};
  return null;
}
export function modelWarmupTarget(provider:string):WarmTarget|null{return targetFor(provider);}
export async function startSelectedModelWarmup(userId:string):Promise<{status:"started"|"recent"|"unsupported";provider:string}> {
  const settings=await getAiCapabilitySettings(userId);
  if(!settings.enabled) return {status:"unsupported",provider:settings.modelProvider};
  const provider=settings.modelProvider;
  const target=targetFor(provider);
  if(!target)return {status:"unsupported",provider};
  // Restrict to the server-configured HTTPS endpoint. The client never chooses an URL.
  const url=new URL(target.url);
  if(url.protocol!=="https:")return {status:"unsupported",provider};
  const key=provider;
  const now=Date.now();
  if(pending.has(key)||(now-(lastStarted.get(key)??0)<WARM_INTERVAL_MS))
    return {status:"recent",provider};
  pending.add(key);
  lastStarted.set(key,now);
  const endpoint=url.pathname.endsWith("/v1/chat/completions")?url:
    new URL(url.pathname.replace(/\/$/,"")+"/v1/chat/completions",url.origin);
  // Intentionally detached, best effort, without storing user prompts or adding chat history.
  void (async()=>{
    try{
      const response=await fetch(endpoint,{
        method:"POST",
        headers:{authorization:`Bearer ${target.token}`,"content-type":"application/json"},
        body:JSON.stringify({model:target.model,messages:[{role:"user",content:"Ready?"}],max_tokens:2,temperature:0,stream:false}),
        signal:AbortSignal.timeout(90_000),
      });
      if(!response.ok){
        lastStarted.delete(key);
        console.warn("[chat-prewarm] inference startup failed",{provider,status:response.status});
      }
      else {await response.arrayBuffer();console.info("[chat-prewarm] inference endpoint warmed",{provider});}
    }catch(error){
      lastStarted.delete(key);
      console.warn("[chat-prewarm] inference warmup unavailable",{provider,errorType:error instanceof Error?error.name:"unknown"});
    }finally{pending.delete(key);}
  })();
  return {status:"started",provider};
}
