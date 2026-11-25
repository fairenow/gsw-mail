import {HttpError} from "../../lib/errors.js";
/** Parse only content deltas, never reasoning or tool arguments. */
export async function readChatTextSse(body:ReadableStream<Uint8Array>,onText:(text:string)=>void){
 const reader=body.getReader(),decoder=new TextDecoder();let pending="",text="",finished=false,done=false;
 function line(raw:string){
  if(!raw.startsWith("data:"))return;
  const data=raw.slice(5).trim();
  if(data==="[DONE]"){done=true;return;}
  if(!data)return;
  let parsed:unknown;try{parsed=JSON.parse(data);}catch{throw new HttpError(502,"Invalid streaming model response");}
  if(!parsed||typeof parsed!=="object")throw new HttpError(502,"Invalid streaming model response");
  const chunk=parsed as {error?:unknown;choices?:Array<{finish_reason?:string|null;delta?:{content?:unknown;tool_calls?:unknown}}>};
  if(chunk.error)throw new HttpError(502,"Streaming model failed");
  const choice=chunk.choices?.[0];
  if(!choice)return;
  if(choice.delta?.tool_calls)throw new HttpError(502,"Unexpected streamed tool request");
  if(choice.finish_reason==="length"||choice.finish_reason==="tool_calls")throw new HttpError(502,"Incomplete streaming model response");
  if(choice.finish_reason==="stop")finished=true;
  const content=choice.delta?.content;
  if(typeof content==="string"&&content){text+=content;if(text.length>120000)throw new HttpError(502,"Streaming response exceeded limit");onText(content);}
 }
 try{
  while(!done){const part=await reader.read();if(part.done)break;pending+=decoder.decode(part.value,{stream:true});if(pending.length>512000)throw new HttpError(502,"Streaming frame exceeded limit");let n:number;while((n=pending.indexOf("\n"))>=0){line(pending.slice(0,n).trimEnd());pending=pending.slice(n+1);}}
  pending+=decoder.decode();if(pending.trim())line(pending.trimEnd());
  if(!finished||!text.trim())throw new HttpError(502,"Streaming response ended before completion");
  return text.trim();
 }finally{await reader.cancel().catch(()=>undefined);reader.releaseLock();}
}
