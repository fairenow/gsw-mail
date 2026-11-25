import { z } from "zod";
import { listManagedEventLinks,saveManagedEventLink,listManagedBookings } from "../../booking/manageLinks.js";
import { eventLinkSchema } from "../../booking/policy.js";
import { reportChatError } from "../chatSafeErrors.js";
import type { AgentToolDefinition,AgentExecutionContext } from "./types.js";
function tool(name:string,description:string,scope:"calendar.read"|"calendar.write",risk:"read"|"external",properties:Record<string,unknown>,required:string[],run:(ctx:AgentExecutionContext,raw:unknown)=>Promise<unknown>):AgentToolDefinition{
 return {name,description,requiredScopes:[scope],risk,inputSchema:{type:"object",properties,required,additionalProperties:false},async execute(ctx,input,toolCallId){
  const startedAt=new Date().toISOString(),audit=()=>({userId:ctx.userId,accountId:ctx.accountId,startedAt,completedAt:new Date().toISOString()});
  try{return {ok:true,toolCallId,data:await run(ctx,input),audit:audit()};}
  catch(error){const safe=reportChatError(error,{operation:name,category:"calendar",retryable:true});return {ok:false,toolCallId,error:safe,audit:audit()};}
 }};
}
const string={type:"string"};
export const bookingTools:AgentToolDefinition[]=[
 tool("calendar.booking_links.list","List the selected mailbox's existing booking links, their exact settings and URLs. Requires mailbox manage permission.","calendar.read","read",{},[],async(ctx,raw)=>{z.object({}).strict().parse(raw);return listManagedEventLinks(ctx.userId,ctx.accountId);}),
 tool("calendar.bookings.list","List recent appointment requests and status for this mailbox or a specific booking link. Requires mailbox manage permission.","calendar.read","read",{linkId:string},[],async(ctx,raw)=>{const i=z.object({linkId:z.uuid().optional()}).strict().parse(raw);return listManagedBookings(ctx.userId,ctx.accountId,i.linkId);}),
 tool("calendar.booking_links.save","Create or update a native GSW Mail booking link. List existing links and calendars first. Confirm exact settings, duration, timezone, availability and approval policy. Enabling a link makes it public and requires background mailbox authorization. Omit id to create.", "calendar.write","external",{id:string,settings:{type:"object",description:"Complete booking link settings. Use existing link settings as a reference.",properties:{name:string,slug:string,calendarId:string,timeZone:string,enabled:{type:"boolean"},mode:{type:"string",enum:["fixed","windows"]},duration:{type:"integer",enum:[15,20,30,45,60]},allowedDurations:{type:"array",items:{type:"integer",enum:[15,20,30,45,60]}},windows:{type:"array",items:{type:"object",properties:{day:{type:"integer",minimum:0,maximum:6},start:string,end:string},required:["day","start","end"],additionalProperties:false}},fixedSlots:{type:"array",items:{type:"object",properties:{date:string,start:string},required:["date","start"],additionalProperties:false}},unavailableDates:{type:"array",items:string},approval:{type:"string",enum:["manual","auto"]},phoneRequired:{type:"boolean"},messageRequired:{type:"boolean"},noticeHours:{type:"integer"},location:string,meetingUrl:string,generateMeeting:{type:"boolean"}},required:["name","slug","calendarId","timeZone","enabled","mode","duration","allowedDurations","windows","fixedSlots","unavailableDates","approval","phoneRequired","messageRequired","noticeHours","location","meetingUrl","generateMeeting"],additionalProperties:false}},["settings"],async(ctx,raw)=>{
  const i=z.object({id:z.uuid().optional(),settings:eventLinkSchema}).strict().parse(raw);
  return saveManagedEventLink({userId:ctx.userId,authUserId:ctx.authUserId,headers:ctx.headers},{...i,accountId:ctx.accountId});
 }),
];
