import type { ProviderToolDefinition } from "./tools/types.js";
const str={type:"string"};
const eventIds={type:"array",items:str,minItems:1,maxItems:10,uniqueItems:true};
const audience={type:"string",enum:["event_registrants","volunteers","sponsors","partners","subscribers","all_registrants"]};
function tool(name:string,description:string,properties:Record<string,unknown>={},required:string[]=[]):ProviderToolDefinition{
 return {type:"function",function:{name:name.replaceAll(".","__"),description,parameters:{type:"object",properties,required,additionalProperties:false}}};
}
export const communityBridgeTools=[
 tool("community.admin.me","Read the current authenticated Community administrator, role and permitted modules."),
 tool("community.events.list","Find accessible Community events, including past events, by title or slug. Returns dates and actual IDs.",{search:str,offset:{type:"integer",minimum:0},limit:{type:"integer",minimum:1,maximum:30}}),
 tool("community.events.read","Read actual Community event details including public registration page and dates.",{eventId:str},["eventId"]),
 tool("community.audience.preview","Check actual Community registrant, volunteer, sponsor, partner or subscriber audience counts and eligible recipients on a page. Does not disclose addresses or send. Use actual event IDs. For multiple previous events use eventIds (up to 10), not an unrelated global audience. Results deduplicate by email.",{eventId:str,eventIds,audienceType:audience,offset:{type:"integer",minimum:0}},["audienceType"]),
 tool("community.contacts.search","Find an explicitly requested individual in an authorized Community audience by exact email or name search. Returns at most 10 matching names and email addresses. Do not use to enumerate bulk mailing lists.",{eventId:str,eventIds,audienceType:audience,search:str},["audienceType","search"]),
];
export const communityBridgeNames=new Set(communityBridgeTools.map(t=>t.function.name.replaceAll("__",".")));
export const campaignPlanTool=tool("community.campaign.prepare","Prepare a Community campaign handoff for human review. First inspect actual events and audience. Use eventIds for a combined historical audience. Does not save or send any email; the Community campaign screen will load eligible recipients and require explicit review.",{eventId:str,eventIds,audienceType:audience,title:str,subject:str,textBody:str},["audienceType","title","subject","textBody"]);
export const eventPlanTool=tool("community.events.prepare","Prepare creation of a private Community event draft or an edit to an accessible existing event. The administrator reviews and saves in the native Events editor. For edits read the actual event first; provide only requested fields and its ID. For new events provide title, description, start/end dates as ISO 8601 including timezone and location. Does not publish or save an event.",{eventId:str,title:str,description:str,start:str,end:str,locationName:str,locationAddress:str,isOnline:{type:"boolean"},onlineUrl:str,capacity:{type:"integer",minimum:1},allowVolunteers:{type:"boolean"},allowSponsors:{type:"boolean"},allowPartners:{type:"boolean"}});
export async function callCommunityBridge(token:string,accountId:string,name:string,rawArguments:string):Promise<unknown>{
 if(!communityBridgeNames.has(name)||rawArguments.length>12000)throw new Error("Unsupported Community tool");
 const configured=process.env.GSW_COMMUNITY_UNSUBSCRIBE_CHECK_URL;
 if(!configured)throw new Error("Community gateway unavailable");
 const url=new URL(configured);
 if(url.protocol!=="https:"||url.username||url.password||url.search||url.hash||url.pathname!=="/gsw-mail/campaign-eligibility")throw new Error("Invalid Community gateway");
 url.pathname="/gsw-mail/ai-tools";
 const response=await fetch(url,{method:"POST",redirect:"error",signal:AbortSignal.timeout(15000),headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},body:JSON.stringify({accountId,name,args:JSON.parse(rawArguments)})});
 if(!response.ok)throw new Error("Community tool denied or unavailable");
 return response.json();
}
