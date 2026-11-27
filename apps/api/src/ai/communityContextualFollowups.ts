import {z} from "zod";
import {followupSchema,type Followup} from "./communityFollowups.js";

type Action={label:string;value:string;description?:string};
const eventSchema=z.object({id:z.string(),title:z.string().min(1),startTime:z.number(),endTime:z.number(),status:z.string(),approvalStatus:z.string().nullable().optional()});
type Event=z.infer<typeof eventSchema>;
const clean=(s:string)=>s.replace(/[\r\n\t]+/g," ").trim().slice(0,180);
function eventLabel(event:Event,timeZone:string){
 return clean(event.title)+" on "+new Intl.DateTimeFormat("en-US",{timeZone,year:"numeric",month:"long",day:"numeric"}).format(event.startTime);
}
export function contextualFollowups(input:{event?:Event;records?:{event:Event;audienceType:string;statusCounts:Record<string,number>;totalRecords:number};mail?:{messageId:string;subject:string};expandedAdmin:boolean;permissions:unknown;permitted:ReadonlySet<string>;campaignAllowed:boolean;timeZone:string;now:number;prompt:string}):Followup|undefined{
 const actions:Action[]=[];
 const {event,records,mail}=input;
 const permissions=z.record(z.string(),z.record(z.string(),z.boolean())).safeParse(input.permissions);
 const can=(module:string,permission:string)=>permissions.success&&permissions.data[module]?.[permission]===true;
 // A single successfully read message, not a search result or inferred recipient.
 if(mail&&(input.permitted.has("mail.reply")||input.permitted.has("mail.create_draft"))){
  actions.push({label:"Draft a reply",value:"Re-read the exact email I just reviewed (message ID "+mail.messageId.slice(0,180)+") and prepare a reply for my review. Do not send it yet."});
 }
 if(records&&input.expandedAdmin){
  const volunteer=records.audienceType==="volunteers",registration=records.audienceType==="event_registrants";
  const count=records.statusCounts[volunteer?"new":"pending"]??0;
  if((volunteer||registration)&&count>0&&can(volunteer?"volunteers":"registrations","edit")){
   const noun=volunteer?"volunteers":"registrants";
   actions.push({label:"Review "+count+" pending "+noun,value:"Find the pending "+noun+" for "+eventLabel(records.event,input.timeZone)+". Show the exact records for review, then prepare individual confirmation actions for the selected records. Do not confirm without approval."});
  }
 }
 if(event&&input.expandedAdmin&&event.approvalStatus==="pending"&&can("events","edit")){
  actions.push({label:"Review event approval",value:"Review the current approval status and details of "+eventLabel(event,input.timeZone)+". Prepare the native event approval for my review if it is still awaiting approval."});
 }
 // Do not offer mass outreach on every informational answer. Offer it when
 // the user is working on outreach, or has just retrieved a nonempty audience.
 const target=records?.event??event;
 const outreach=/\b(email|mail|message|contact|outreach|announcement|invite|invitation|remind|reminder|blast|campaign|follow.up)\b/i.test(input.prompt);
 if(target&&input.campaignAllowed&&can("emailCampaigns","send")&&(outreach||!!records&&records.totalRecords>0)){
  const audience=records?.audienceType==="volunteers"?"volunteers":records?.audienceType==="event_registrants"?"registrants":records?.audienceType==="sponsors"?"sponsors":null;
  if(audience||outreach)actions.push({label:audience?"Prepare individual emails to "+audience:"Prepare event email campaign",value:"Prepare a reviewed email campaign for "+eventLabel(target,input.timeZone)+(audience?" targeting its "+audience:"")+". Verify the eligible recipients and draft the subject and content. Send one separate message per eligible recipient only after my explicit approval."});
 }
 const parsed=followupSchema.safeParse({kind:"actions",question:"Suggested next steps",options:actions.slice(0,2)});
 return parsed.success?parsed.data:undefined;
}
export const followupEventSchema=eventSchema;
export const followupRecordsSchema=z.object({resolution:z.literal("resolved"),event:eventSchema,audienceType:z.string(),statusCounts:z.record(z.string(),z.number().int().nonnegative()),totalRecords:z.number().int().nonnegative()});
export const followupMailSchema=z.object({messageId:z.string().min(1).max(512),subject:z.string()});
