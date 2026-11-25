import {HttpError} from "../../lib/errors.js";
/** Native event streams from providers with distinct wire formats. Only text
 * output events may reach the client; reasoning and tool payloads are ignored. */
export async function readFinalTextSse(body:ReadableStream<Uint8Array>,kind:"openai"|"anthropic",onText:(text:string)=>void){
 const reader=body.getReader(),decoder=new TextDecoder();let pending="",text="",complete=false;
 function frame(line:string){
  if(!line.startsWith("data:"))return;
  const raw=line.slice(5).trim();if(!raw||raw==="[DONE]")return;
  let e:any;try{e=JSON.parse(raw);}catch{throw new HttpError(502,"Invalid model stream");}
  if(!e||typeof e!=="object")throw new HttpError(502,"Invalid model stream");
  let delta:unknown;
  if(kind==="openai"){
   if(["error","response.failed","response.incomplete"].includes(e.type))throw new HttpError(502,"Model stream did not complete");
   if(e.type==="response.output_item.added"&&e.item?.type==="function_call")throw new HttpError(502,"Unexpected model tool call");
   if(e.type==="response.output_text.delta")delta=e.delta;
   if(e.type==="response.completed")complete=true;
  }else{
   if(e.type==="error"||e.type==="message_delta"&&["max_tokens","tool_use"].includes(e.delta?.stop_reason))throw new HttpError(502,"Model stream did not complete");
   if(e.type==="content_block_start"&&e.content_block?.type==="tool_use")throw new HttpError(502,"Unexpected model tool call");
   if(e.type==="content_block_delta"&&e.delta?.type==="text_delta")delta=e.delta.text;
   if(e.type==="message_stop")complete=true;
  }
  if(typeof delta==="string"&&delta){text+=delta;if(text.length>120000)throw new HttpError(502,"Model response exceeded limit");onText(delta);}
 }
 try{while(!complete){const part=await reader.read();if(part.done)break;pending+=decoder.decode(part.value,{stream:true});if(pending.length>512000)throw new HttpError(502,"Model stream frame exceeded limit");let n:number;while((n=pending.indexOf("\n"))>=0){frame(pending.slice(0,n).trimEnd());pending=pending.slice(n+1);}}pending+=decoder.decode();if(pending.trim())frame(pending.trimEnd());if(!complete||!text.trim())throw new HttpError(502,"Model stream ended before completion");return text.trim();}
 finally{await reader.cancel().catch(()=>undefined);reader.releaseLock();}
}
