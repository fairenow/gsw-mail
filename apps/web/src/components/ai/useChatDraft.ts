import {useRef,useState,type KeyboardEvent} from "react";

const memory=new Map<string,string>();
export function readChatValue(key:string):string{
 try{return localStorage.getItem(key)??"";}catch{return memory.get(key)??"";}
}
export function writeChatValue(key:string,value:string){
 if(value)memory.set(key,value);else memory.delete(key);
 try{if(value)localStorage.setItem(key,value);else localStorage.removeItem(key);}catch{/* Keep the current session usable if storage is unavailable. */}
}
export function draftKey(scope:string,conversation:string|null){return "gsw:chat-draft:v1:"+encodeURIComponent(scope)+":"+encodeURIComponent(conversation||"new");}
export function activeChatKey(scope:string){return "gsw:chat-active:v1:"+encodeURIComponent(scope);}

// Synchronous text-only persistence: no debounce or unload event required.
// History recall is a preview, so merely browsing old prompts does not overwrite a draft.
export function useChatDraft(scope:string,conversation:string|null){
 const key=draftKey(scope,conversation);
 const state=useRef({key,draft:readChatValue(key),index:-1,preview:""});
 const [,render]=useState(0);
 if(state.current.key!==key)state.current={key,draft:readChatValue(key),index:-1,preview:""};
 const value=state.current.index<0?state.current.draft:state.current.preview;
 function setValue(next:string|((old:string)=>string)){
  // A late callback from a previous conversation must not overwrite the open one.
  if(state.current.key!==key)return;
  const current=state.current;
  const text=typeof next==="function"?next(current.index<0?current.draft:current.preview):next;
  current.draft=text;current.index=-1;current.preview="";
  writeChatValue(key,text);render(n=>n+1);
 }
 function clearSent(sent:string){
  const current=state.current;
  const draft=current.key===key?current.draft:readChatValue(key);
  if(draft.trim()===sent.trim()){
   writeChatValue(key,"");
   if(current.key===key)current.draft="";
  }
  if(current.key===key){current.index=-1;current.preview="";render(n=>n+1);}
 }
 function recall(event:KeyboardEvent<HTMLTextAreaElement>,messages:string[]){
  if(event.nativeEvent.isComposing||event.altKey||event.ctrlKey||event.metaKey||event.shiftKey||!["ArrowUp","ArrowDown"].includes(event.key))return false;
  const current=state.current,element=event.currentTarget;
  if(current.key!==key||element.selectionStart!==element.selectionEnd)return false;
  const up=event.key==="ArrowUp";
  // Preserve normal cursor movement through multiline input. Start recall at
  // the beginning of the composer; Down restores the unsent draft.
  if(up&&element.selectionStart!==0&&element.value!=="")return false;
  if(!up&&(current.index<0||element.selectionEnd!==element.value.length&&element.selectionEnd!==0))return false;
  const history=messages.filter(text=>text.trim()).slice().reverse();
  if(!history.length)return false;
  event.preventDefault();
  current.index=up?Math.min(current.index+1,history.length-1):Math.max(-1,current.index-1);
  current.preview=current.index<0?"":history[current.index]??"";
  render(n=>n+1);
  requestAnimationFrame(()=>{if(element.isConnected){const position=current.index<0?element.value.length:0;element.setSelectionRange(position,position);}});
  return true;
 }
 return {value,setValue,clearSent,recall};
}
