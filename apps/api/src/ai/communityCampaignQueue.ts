import { randomUUID } from "node:crypto";
import { pool } from "../db/client.js";
import { requireAccountPermission } from "../auth/authorize.js";
import { resolveMcpAccessProfile } from "../mcp/accessProfile.js";
import { launchCampaign,previewCampaign } from "./campaignService.js";
import { COMMUNITY_AUDIENCE_TAG } from "./communityCampaignPolicy.js";
import { badRequest,conflict,forbidden } from "../lib/errors.js";
type Owner={userId:string;authUserId:string;clientId:string;accountId:string};
type Job={campaign_id:string;user_id:string;auth_user_id:string;client_id:string;account_id:string;review_hash:string;scheduled_at:Date;status:string;lease_owner:string|null};
export async function ensureCommunityCampaignQueue(){
 await pool.query(`CREATE TABLE IF NOT EXISTS community_campaign_jobs (
 campaign_id uuid PRIMARY KEY REFERENCES ai_campaigns(id) ON DELETE CASCADE,
 user_id text NOT NULL, auth_user_id text NOT NULL, client_id text NOT NULL, account_id uuid NOT NULL,
 review_hash text NOT NULL, scheduled_at timestamptz NOT NULL, status text NOT NULL CHECK(status IN ('queued','running','completed','cancelled','failed','uncertain')),
 lease_owner text,lease_expires_at timestamptz,result jsonb,updated_at timestamptz NOT NULL DEFAULT now()
 ); CREATE INDEX IF NOT EXISTS community_campaign_jobs_due ON community_campaign_jobs(scheduled_at) WHERE status='queued';`);
}
const required=["openid","campaign.send","mail.send","templates.read","signatures.read"];
export async function assertCommunityCampaignAuthorization(owner:Owner){
 if(!process.env.GSW_COMMUNITY_OAUTH_CLIENT_ID||owner.clientId!==process.env.GSW_COMMUNITY_OAUTH_CLIENT_ID)throw forbidden();
 const {rows}=await pool.query<{scopes:string[]}>(`SELECT c.scopes FROM oauth_consent c
 JOIN oauth_client cl ON cl.client_id=c.client_id AND cl.disabled=false
 JOIN users u ON u.auth_user_id=c.user_id AND u.status='active'
 WHERE c.user_id=$1 AND c.client_id=$2 AND u.id=$3 LIMIT 1`,[owner.authUserId,owner.clientId,owner.userId]);
 if(!rows[0]||!required.every(scope=>rows[0]!.scopes.includes(scope)))throw forbidden();
 if((await resolveMcpAccessProfile(owner.userId,owner.authUserId)).mode!=="mailbox")throw forbidden();
 const mailbox=await requireAccountPermission(owner.userId,owner.accountId,"send");
 if(mailbox.status!=="active")throw forbidden();
}
export function validCampaignSchedule(at:number,now=Date.now()){
 return Number.isSafeInteger(at)&&at>=now-60_000&&at<=now+365*86400000;
}
export async function enqueueCommunityCampaign(owner:Owner,campaignId:string,hash:string,scheduledAt:number){
 if(!validCampaignSchedule(scheduledAt))throw badRequest("Invalid scheduled time");
 await assertCommunityCampaignAuthorization(owner);
 const preview=await previewCampaign({userId:owner.userId,accountId:owner.accountId,campaignId});
 if(preview.campaign.reviewHash!==hash)throw conflict("Review changed");
 const client=await pool.connect();
 try{
  await client.query("BEGIN");
  const campaign=await client.query<{status:string;audience_tags:string[]}>(`SELECT status,audience_tags FROM ai_campaigns WHERE id=$1 AND user_id=$2 AND account_id=$3 FOR UPDATE`,[campaignId,owner.userId,owner.accountId]);
  if(!campaign.rows[0]?.audience_tags.includes(COMMUNITY_AUDIENCE_TAG))throw forbidden();
  const existing=await client.query<Job>("SELECT * FROM community_campaign_jobs WHERE campaign_id=$1 FOR UPDATE",[campaignId]);
  const previous=existing.rows[0];
  if(previous&&previous.status!=="cancelled"){
   if(previous.user_id!==owner.userId||previous.client_id!==owner.clientId||previous.review_hash!==hash||previous.scheduled_at.getTime()!==scheduledAt)throw conflict("A launch already exists; check campaign status");
   await client.query("COMMIT");return {status:previous.status,scheduledAt:previous.scheduled_at.toISOString()};
  }
  if(campaign.rows[0].status!=="draft")throw conflict("Campaign is not a draft");
  await client.query(`INSERT INTO community_campaign_jobs(campaign_id,user_id,auth_user_id,client_id,account_id,review_hash,scheduled_at,status)
   VALUES($1,$2,$3,$4,$5,$6,$7,'queued') ON CONFLICT(campaign_id) DO UPDATE SET review_hash=EXCLUDED.review_hash,scheduled_at=EXCLUDED.scheduled_at,status='queued',result=NULL,lease_owner=NULL,lease_expires_at=NULL,updated_at=now()`,
   [campaignId,owner.userId,owner.authUserId,owner.clientId,owner.accountId,hash,new Date(scheduledAt)]);
  await client.query("UPDATE ai_campaigns SET status='scheduled',updated_at=now() WHERE id=$1",[campaignId]);
  await client.query("COMMIT");return {status:"queued",scheduledAt:new Date(scheduledAt).toISOString()};
 }catch(e){await client.query("ROLLBACK");throw e;}finally{client.release();}
}
export async function cancelCommunityCampaign(owner:Owner,campaignId:string){
 const client=await pool.connect();
 try{
  await client.query("BEGIN");
  const row=await client.query("SELECT id FROM ai_campaigns WHERE id=$1 AND user_id=$2 AND account_id=$3 AND status='scheduled' FOR UPDATE",[campaignId,owner.userId,owner.accountId]);
  if(!row.rowCount)throw conflict("Campaign is not awaiting launch");
  const cancelled=await client.query(`UPDATE community_campaign_jobs SET status='cancelled',updated_at=now() WHERE campaign_id=$1 AND user_id=$2 AND account_id=$3 AND client_id=$4 AND status='queued'`,[campaignId,owner.userId,owner.accountId,owner.clientId]);
  if(!cancelled.rowCount)throw conflict("Campaign is already running");
  await client.query("UPDATE ai_campaigns SET status='draft',updated_at=now() WHERE id=$1",[campaignId]);
  await client.query("COMMIT");return {cancelled:true};
 }catch(e){await client.query("ROLLBACK");throw e;}finally{client.release();}
}
export async function communityCampaignJob(owner:{userId:string;accountId:string;clientId:string},campaignId:string){
 const {rows}=await pool.query<{status:string;scheduled_at:Date;result:unknown}>(`SELECT status,scheduled_at,result FROM community_campaign_jobs WHERE campaign_id=$1 AND user_id=$2 AND account_id=$3 AND client_id=$4`,[campaignId,owner.userId,owner.accountId,owner.clientId]);
 const job=rows[0];return job?{status:job.status,scheduledAt:job.scheduled_at.toISOString(),result:job.result}:null;
}
export function startCommunityCampaignWorker(onError:(error:unknown)=>void){
 const lease=randomUUID();let busy=false,stopped=false;
 const tick=async()=>{
  if(busy||stopped)return;busy=true;
  try{
   await pool.query(`UPDATE community_campaign_jobs SET status='uncertain',lease_owner=NULL,lease_expires_at=NULL,updated_at=now() WHERE status='running' AND lease_expires_at<now()`);
   const {rows}=await pool.query<Job>(`WITH next AS (SELECT campaign_id FROM community_campaign_jobs WHERE status='queued' AND scheduled_at<=now() ORDER BY scheduled_at FOR UPDATE SKIP LOCKED LIMIT 1)
     UPDATE community_campaign_jobs j SET status='running',lease_owner=$1,lease_expires_at=now()+interval '5 minutes',updated_at=now() FROM next WHERE j.campaign_id=next.campaign_id RETURNING j.*`,[lease]);
   const job=rows[0];if(!job)return;
   let lost=false;
   const heartbeat=setInterval(()=>{void pool.query(`UPDATE community_campaign_jobs SET lease_expires_at=now()+interval '5 minutes',updated_at=now() WHERE campaign_id=$1 AND lease_owner=$2 AND status='running' AND lease_expires_at>now()`,[job.campaign_id,lease]).then(x=>{if(!x.rowCount)lost=true;}).catch(()=>{lost=true;});},30000);
   const owner={userId:job.user_id,authUserId:job.auth_user_id,clientId:job.client_id,accountId:job.account_id};
   const check=async()=>{
    if(lost||stopped)throw new Error("Campaign worker lease unavailable");
    const row=await pool.query("SELECT 1 FROM community_campaign_jobs WHERE campaign_id=$1 AND lease_owner=$2 AND status='running' AND lease_expires_at>now()",[job.campaign_id,lease]);
    if(!row.rowCount)throw new Error("Campaign worker lease expired");
    await assertCommunityCampaignAuthorization(owner);
   };
   try{
    await check();
    const result=await launchCampaign({userId:owner.userId,authUserId:owner.authUserId,accountId:owner.accountId,headers:{}},job.campaign_id,job.review_hash,{scheduled:true,checkAuthorization:check});
    if(lost||stopped)throw new Error("Launch outcome needs verification");
    await pool.query(`UPDATE community_campaign_jobs SET status='completed',result=$3,lease_owner=NULL,lease_expires_at=NULL,updated_at=now() WHERE campaign_id=$1 AND lease_owner=$2 AND status='running' AND lease_expires_at>now()`,[job.campaign_id,lease,JSON.stringify({queued:result.sent,failed:result.failed,status:result.campaign.status})]);
   }catch{
    // Never auto-replay a potentially partially completed external send.
    await pool.query(`UPDATE community_campaign_jobs SET status='uncertain',lease_owner=NULL,lease_expires_at=NULL,updated_at=now() WHERE campaign_id=$1 AND lease_owner=$2 AND status='running'`,[job.campaign_id,lease]);
   }finally{clearInterval(heartbeat);}
  }catch(error){onError(error);}finally{busy=false;}
 };
 const timer=setInterval(()=>void tick(),15000);timer.unref();void tick();
 return ()=>{stopped=true;clearInterval(timer);};
}
