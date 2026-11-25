import {runModelRound,assistantToolMessage} from "./modelRound.js";
import type {AiProvider,AiProviderMessage,AiProviderRunResult,AiToolCall} from "./providers/types.js";
import type {ProviderToolDefinition} from "./tools/types.js";
import {HttpError} from "../lib/errors.js";

export type ExecutionRound<C>={round:number;context:C;result:AiProviderRunResult};
type ToolInput<C>=ExecutionRound<C>&{call:AiToolCall;respond:(content:string)=>void};
export type ExecutionOutcome<T>=
 | {kind:"completed";result:AiProviderRunResult;round:number;limitReached:boolean}
 | {kind:"stopped";value:T}
 | {kind:"exhausted";model:string};
export type ExecutionOptions<T,C>={
 provider:AiProvider;messages:AiProviderMessage[];
 maxToolRounds:number;maxCallsPerRound:number;
 prepareRound:(round:number,final:boolean)=>Promise<{tools?:ProviderToolDefinition[]|undefined;context:C}>;
 onRoundResult?:(round:ExecutionRound<C>)=>void|Promise<void>;
 onTool:(input:ToolInput<C>)=>Promise<T|undefined>;
 onRejectedCall?:(call:AiToolCall,reason:"not_advertised"|"batch_limit")=>void;
 finalization?:{prompt?:string;onError?:(error:unknown)=>void};
 signal?:AbortSignal;onDelta?:(text:string)=>void;
};
/**
 * One bounded turn loop for interactive native, delegated and scheduled AI.
 * This layer owns model calls, allowed tool dispatch, transcript pairing and
 * termination. Policy adapters own live authorization, audit, approval and
 * effects. They cannot ask the engine to replay a call or bypass review.
 */
export async function executeAiTurn<T,C>(options:ExecutionOptions<T,C>):Promise<ExecutionOutcome<T>>{
 const {provider,messages,signal}=options;
 if(!Number.isInteger(options.maxToolRounds)||options.maxToolRounds<1||options.maxToolRounds>32||!Number.isInteger(options.maxCallsPerRound)||options.maxCallsPerRound<1||options.maxCallsPerRound>16)throw new Error("Invalid execution budget");
 let model="";
 const callIds=new Set(messages.flatMap(m=>m.role==="assistant"?(m.tool_calls??[]).map(c=>c.id):[]));
 for(let round=0;round<=options.maxToolRounds;round++){
  signal?.throwIfAborted();
  const final=round===options.maxToolRounds;
  if(final&&!options.finalization)break;
  // The adapter must reauthorize before preparing each round, including finalization.
  const prepared=await options.prepareRound(round,final);
  signal?.throwIfAborted();
  const tools=final?[]:prepared.tools;
  const roundMessages=final&&options.finalization?.prompt?[...messages,{role:"user" as const,content:options.finalization.prompt}]:messages;
  let result:AiProviderRunResult;
  try{
   result=await runModelRound(provider,{messages:roundMessages,tools},{...(signal?{signal}:{}),...(options.onDelta?{onDelta:options.onDelta}:{})});
  }catch(error){
   if(!final||!options.finalization?.onError||signal?.aborted)throw error;
   options.finalization.onError(error);break;
  }
  model=result.model;
  await options.onRoundResult?.({round,context:prepared.context,result});
  signal?.throwIfAborted();
  if(!result.toolCalls.length)return {kind:"completed",result,round,limitReached:final};
  if(result.toolCalls.length>64)throw new HttpError(502,"Model returned too many tool requests");
  // Reject repeated provider call IDs before any operation in this round.
  for(const call of result.toolCalls){if(callIds.has(call.id))throw new HttpError(502,"Repeated model tool call ID");callIds.add(call.id);}
  messages.push(assistantToolMessage(result));
  const advertised=new Set((tools??[]).map(t=>t.function.name.replaceAll("__",".")));
  const oversized=result.toolCalls.length>options.maxCallsPerRound;
  for(const call of result.toolCalls){
   signal?.throwIfAborted();
   const reason=oversized?"batch_limit":!advertised.has(call.function.name.replaceAll("__","."))?"not_advertised":null;
   if(reason){
    options.onRejectedCall?.(call,reason);
    messages.push({role:"tool",tool_call_id:call.id,content:JSON.stringify({ok:false,error:reason==="batch_limit"?"Too many tool requests in one round. No operations from this batch were executed. Try fewer calls.":"Tool not available in this execution round."})});
    continue;
   }
   let response:string|undefined;
   const value=await options.onTool({round,context:prepared.context,result,call,respond(content){if(response!==undefined)throw new Error("Tool returned multiple responses");response=content;}});
   signal?.throwIfAborted();
   if(value!==undefined)return {kind:"stopped",value};
   if(response===undefined)throw new Error("Tool adapter did not return a response");
   messages.push({role:"tool",tool_call_id:call.id,content:response});
  }
 }
 return {kind:"exhausted",model};
}
