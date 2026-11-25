import { badRequest,serviceUnavailable } from "../lib/errors.js";
import { z } from "zod";
export const communityProofSchema=z.string().regex(/^\d{13}\.[A-Za-z0-9_-]{43}$/);
export async function verifyCommunityRegistration(input:{linkId:string;requestId:string;email:string;proof:string},options:{endpoint?:string;fetcher?:typeof fetch}={}){
 const raw=options.endpoint??process.env.GSW_COMMUNITY_UNSUBSCRIBE_CHECK_URL;
 if(!raw)throw serviceUnavailable("Community registration verification unavailable");
 const url=new URL(raw);
 if(url.protocol!=="https:"||url.username||url.password||url.search||url.hash||url.pathname!=="/gsw-mail/campaign-eligibility")throw serviceUnavailable("Community registration verification unavailable");
 url.pathname="/gsw-mail/booking-validate";
 let response:Response;
 try{response=await (options.fetcher??fetch)(url,{method:"POST",redirect:"error",signal:AbortSignal.timeout(8000),headers:{"Content-Type":"application/json"},body:JSON.stringify(input)});}catch{throw serviceUnavailable("Community registration verification unavailable");}
 if(!response.ok)throw serviceUnavailable("Community registration verification unavailable");
 const result=z.object({valid:z.boolean()}).safeParse(await response.json().catch(()=>null));
 if(!result.success||!result.data.valid)throw badRequest("Registration could not be verified. Return to your Community registration and use the same email address.");
}
