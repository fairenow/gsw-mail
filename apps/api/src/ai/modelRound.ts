import type {AiProvider,AiProviderRunInput,AiProviderRunResult,AiProviderMessage} from "./providers/types.js";
import {HttpError} from "../lib/errors.js";
export type ModelRoundProgress={phase:"thinking"|"reviewing";label:string};
export async function runModelRound(provider:AiProvider,input:AiProviderRunInput,options:{onDelta?:(text:string)=>void;signal?:AbortSignal}={}):Promise<AiProviderRunResult>{
 options.signal?.throwIfAborted();
 // Only a tool-free round can expose live answer text. Tool-selection rounds
 // may contain speculative prose and must not expose it as verified output.
 const result=await provider.run({...input,...(!input.tools?.length&&options.onDelta?{onTextDelta:options.onDelta}:{}),...(options.signal?{signal:options.signal}:{})});
 options.signal?.throwIfAborted();
 if(!result.model||(!result.content?.trim()&&!result.toolCalls.length))throw new HttpError(502,"Model returned no usable response");
 const ids=new Set<string>();
 for(const call of result.toolCalls){
  if(!call.id||ids.has(call.id)||!call.function.name||typeof call.function.arguments!=="string"||call.function.arguments.length>100000)throw new HttpError(502,"Model returned an invalid tool request");
  ids.add(call.id);
 }
 if(!input.tools?.length&&result.toolCalls.length)throw new HttpError(502,"Model requested tools during a tool-free response");
 return result;
}
export function assistantToolMessage(result:AiProviderRunResult):AiProviderMessage{
 return {role:"assistant",content:result.content,tool_calls:result.toolCalls,...(result.reasoningContent!==undefined?{reasoning_content:result.reasoningContent}:{})};
}
