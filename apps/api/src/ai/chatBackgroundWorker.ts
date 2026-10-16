import { randomUUID } from "node:crypto";
import { z } from "zod";
import { appendAiMessage } from "./agentState.js";
import { getAiCapabilitySettings } from "./capabilities.js";
import { getAiProvider } from "./providers/index.js";
import { claimChatExecution, finishChatExecution, heartbeatChatExecution, quarantineExpiredChatExecutions } from "./chatExecutionQueue.js";
import { updateChatCommand } from "./chatCommands.js";
import { pool } from "../db/client.js";

// Deliberately model-only. Mail/JMAP and external side effects require a
// revocable offline user authorization and per-tool durable checkpoints.
export const backgroundChatRequestSchema = z.object({
  kind: z.literal("model_only"),
  messages: z.array(z.object({role:z.enum(["user","assistant"]),content:z.string().max(20_000)})).min(1).max(30),
});
const owner = `gsw-chat-worker:${randomUUID()}`;
let timer: ReturnType<typeof setInterval>|null=null;
let running=false;
const LEASE_SECONDS=180;

async function workOnce() {
  if(running)return;
  running=true;
  try{
    await quarantineExpiredChatExecutions();
    const job=await claimChatExecution(owner,LEASE_SECONDS);
    if(!job)return;
    const heartbeat=setInterval(()=>{
      void heartbeatChatExecution(job.id,owner,LEASE_SECONDS).catch(err=>
        console.error("[chat-worker] heartbeat failed",{executionId:job.id,errorType:err instanceof Error?err.name:"unknown"}));
    },30_000);
    try{
      const request=backgroundChatRequestSchema.parse(job.request);
      if(job.account_id)throw new Error("Offline mailbox tool execution is not authorized");
      if(!job.conversation_id)throw new Error("Missing durable conversation");
      const settings=await getAiCapabilitySettings(job.user_id);
      if(!settings.enabled)throw new Error("GSW AI is disabled");
      const provider=getAiProvider(settings.modelProvider);
      // Avoid replaying an ambiguous provider outcome after a crash.
      const messages=request.messages.map(message=>message.role==="user" ? {role:"user" as const,content:message.content} : {role:"assistant" as const,content:message.content});
      const result=await provider.run({messages});
      const content=result.content?.trim();
      if(!content || result.toolCalls?.length)throw new Error("Model-only worker returned no usable reply");
      await appendAiMessage({conversationId:job.conversation_id,role:"assistant",content,
        provider:provider.id,model:result.model});
      const response={
        conversationId:job.conversation_id,
        message:{role:"assistant" as const,content},intervention:null,
        model:result.model,capabilities:{actions:false,mailboxAccess:false,rewriteEmail:false,
          persistentConversation:true,streamingExecution:false},
        toolActivity:[],
      };
      const done=await finishChatExecution(job.id,owner,"completed",response);
      if(done)await updateChatCommand(`chat-command:${job.user_id}:${job.command_id}`,"completed",{
        conversationId:job.conversation_id,response,
      });
      console.info("[chat-worker] job completed",{executionId:job.id,commandId:job.command_id});
    }catch(error){
      await finishChatExecution(job.id,owner,"uncertain",undefined,"Background execution could not be verified");
      console.error("[chat-worker] job requires review",{executionId:job.id,
        errorType:error instanceof Error?error.name:"unknown"});
    }finally{clearInterval(heartbeat);}
  }catch(error){
    console.error("[chat-worker] poll failed",{errorType:error instanceof Error?error.name:"unknown"});
  }finally{running=false;}
}
export function startChatExecutionWorker(){
  if(timer)return ()=>undefined;
  // Call from the Railway API process, not the browser.
  timer=setInterval(()=>void workOnce(),1500);
  timer.unref();
  void workOnce();
  return ()=>{if(timer)clearInterval(timer);timer=null;};
}
