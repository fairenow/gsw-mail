import { randomUUID } from "node:crypto";
import { pool } from "../db/client.js";
import { launchCampaign,previewCampaign } from "./campaignService.js";
import { COMMUNITY_AUDIENCE_TAG,validCampaignSchedule,sameCampaignLaunch } from "./communityCampaignPolicy.js";
import { badRequest,conflict,forbidden,HttpError } from "../lib/errors.js";
type Owner={userId:string;authUserId:string;clientId:string;accountId:string};
type Job={campaign_id:string;user_id:string;auth_user_id:string;client_id:string;consent_id:string|null;account_id:string;review_hash:string;scheduled_at:Date;status:string;lease_owner:string|null};
export async function ensureCommunityCampaignQueue(){
 await pool.query(`CREATE TABLE IF NOT EXISTS community_campaign_jobs (
 campaign_id uuid PRIMARY KEY REFERENCES ai_campaigns(id) ON DELETE CASCADE,
 user_id text NOT NULL, auth_user_id text NOT NULL, client_id text NOT NULL, consent_id text, account_id uuid NOT NULL,
 review_hash text NOT NULL, scheduled_at timestamptz NOT NULL, status text NOT NULL CHECK(status IN ('queued','running','completed','cancelled','failed','uncertain')),
 lease_owner text,lease_expires_at timestamptz,result jsonb,updated_at timestamptz NOT NULL DEFAULT now()
 ); ALTER TABLE community_campaign_jobs ADD COLUMN IF NOT EXISTS consent_id text; CREATE INDEX IF NOT EXISTS community_campaign_jobs_due ON community_campaign_jobs(scheduled_at) WHERE status='queued';`);
}
const required=["openid","campaign.send","mail.send","templates.read","signatures.read"];
type Stage="lease"|"authorization"|"review"|"launch"|"finalize";
function diagnosticCode(error:unknown){
 if(error instanceof HttpError)return error.status===403&&authFailures.has(error.message)?error.message:"http_"+error.status;
 const code=(error as {code?:unknown}|null)?.code;
 if(typeof code==="string"&&/^[0-9A-Z]{5}$/.test(code))return "sql_"+code;
 if(error instanceof Error&&/lease/i.test(error.message))return "lease_unavailable";
 if(error instanceof Error&&/review changed/i.test(error.message))return "review_changed";
 return "execution_error";
}
function workerDiagnostic(campaignId:string,stage:Stage,code:string){
 // No recipient addresses, tokens, SQL parameters or message bodies in logs.
 console.warn(JSON.stringify({event:"community_campaign_worker_diagnostic",campaignId,stage,code}));
}
async function verifyScheduledReview(owner:Owner,job:Job){
 await assertCommunityCampaignAuthorization(owner,job.consent_id??undefined);
 if(!job.consent_id)denyAuthorization("saved_consent_missing");
 const preview=await previewCampaign({userId:owner.userId,accountId:owner.accountId,campaignId:job.campaign_id});
 if(preview.campaign.status!=="scheduled"||preview.campaign.reviewHash!==job.review_hash)throw conflict("Review changed");
}

// Check the saved principal, exact consent and live mailbox permissions in
// one database snapshot. Never manufacture a bearer token or bypass consent.
const authFailures=new Set(["client_mismatch","consent_missing_or_user_inactive","consent_changed","consent_scopes_missing","mailbox_identity_missing","mailbox_send_denied","saved_consent_missing"]);
function denyAuthorization(code:string):never{throw forbidden(code);}
async function assertCommunityCampaignAuthorization(owner:Owner,expectedConsentId?:string){
 if(!process.env.GSW_COMMUNITY_OAUTH_CLIENT_ID||owner.clientId!==process.env.GSW_COMMUNITY_OAUTH_CLIENT_ID)denyAuthorization("client_mismatch");
 const {rows}=await pool.query<{consent_id:string;scopes_ok:boolean;mailbox_identity:boolean;send_allowed:boolean}>(`
 SELECT c.id AS consent_id,c.scopes @> $4::text[] AS scopes_ok,
 EXISTS(SELECT 1 FROM auth_users au JOIN email_accounts e ON lower(e.address)=lower(au.email)
  LEFT JOIN mail_account_memberships m ON m.account_id=e.id
  WHERE au.id=$1 AND (e.user_id=$3 OR (m.user_id=$3 AND m.auth_user_id=$1))) AS mailbox_identity,
 EXISTS(SELECT 1 FROM email_accounts e JOIN domains d ON d.id=e.domain_id
  JOIN mail_account_memberships m ON m.account_id=e.id
  WHERE e.id=$5::uuid AND m.user_id=$3 AND m.account_membership_role IN ('owner','delegate')
  AND e.account_status='active') AS send_allowed
 FROM oauth_consent c JOIN oauth_client cl ON cl.client_id=c.client_id AND cl.disabled=false
 JOIN users u ON u.auth_user_id=c.user_id AND u.id=$3 AND u.user_status='active'
 WHERE c.user_id=$1 AND c.client_id=$2
 ORDER BY c.id LIMIT 2`,[owner.authUserId,owner.clientId,owner.userId,required,owner.accountId]);
 const row=rows[0];
 if(!row||rows.length!==1)denyAuthorization("consent_missing_or_user_inactive");
 if(expectedConsentId!==undefined&&row.consent_id!==expectedConsentId)denyAuthorization("consent_changed");
 if(row.scopes_ok!==true)denyAuthorization("consent_scopes_missing");
 if(row.mailbox_identity!==true)denyAuthorization("mailbox_identity_missing");
 if(row.send_allowed!==true)denyAuthorization("mailbox_send_denied");
 return row.consent_id;
}
export async function enqueueCommunityCampaign(owner:Owner,campaignId:string,hash:string,scheduledAt:number){
 if(!Number.isSafeInteger(scheduledAt))throw badRequest("Invalid scheduled time");
 const consentId=await assertCommunityCampaignAuthorization(owner);
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
   if(!sameCampaignLaunch({userId:previous.user_id,clientId:previous.client_id,consentId:previous.consent_id,hash:previous.review_hash,scheduledAt:previous.scheduled_at.getTime()},{userId:owner.userId,clientId:owner.clientId,consentId,hash,scheduledAt}))throw conflict("A launch already exists; check campaign status");
   await client.query("COMMIT");return {status:previous.status,scheduledAt:previous.scheduled_at.toISOString()};
  }
  if(!validCampaignSchedule(scheduledAt))throw badRequest("Invalid scheduled time");
  if(campaign.rows[0].status!=="draft")throw conflict("Campaign is not a draft");
  await client.query(`INSERT INTO community_campaign_jobs(campaign_id,user_id,auth_user_id,client_id,account_id,review_hash,scheduled_at,consent_id,status)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,'queued') ON CONFLICT(campaign_id) DO UPDATE SET consent_id=EXCLUDED.consent_id,review_hash=EXCLUDED.review_hash,scheduled_at=EXCLUDED.scheduled_at,status='queued',result=NULL,lease_owner=NULL,lease_expires_at=NULL,updated_at=now()`,
   [campaignId,owner.userId,owner.authUserId,owner.clientId,owner.accountId,hash,new Date(scheduledAt),consentId]);
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
  // A previously stopped pre-launch attempt is recoverable only if no
  // recipient changed state and no outbound idempotency record exists.
  const cancelled=await client.query(`UPDATE community_campaign_jobs j SET status='cancelled',updated_at=now()
   WHERE campaign_id=$1 AND user_id=$2 AND account_id=$3 AND client_id=$4
   AND (status='queued' OR (status IN ('failed','uncertain') AND lease_owner IS NULL
    AND NOT EXISTS (SELECT 1 FROM ai_campaign_recipients r WHERE r.campaign_id=j.campaign_id AND (r.status<>'pending' OR r.send_id IS NOT NULL))
    AND NOT EXISTS (SELECT 1 FROM outbound_messages o WHERE o.account_id=j.account_id AND o.client_request_id LIKE 'campaign:'||j.campaign_id::text||':%')))`,[campaignId,owner.userId,owner.accountId,owner.clientId]);
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
    if(row.rows.length!==1)throw new Error("Campaign worker lease expired");
    if(!job.consent_id)denyAuthorization("saved_consent_missing");
    await assertCommunityCampaignAuthorization(owner,job.consent_id);
   };
   let stage:Stage="lease";
   try{
    stage="authorization";
    await check();
    stage="review";
    await verifyScheduledReview(owner,job);
    stage="launch";
    const result=await launchCampaign({userId:owner.userId,authUserId:owner.authUserId,accountId:owner.accountId,headers:{}},job.campaign_id,job.review_hash,{scheduled:true,checkAuthorization:check});
    stage="finalize";
    if(lost||stopped)throw new Error("Launch outcome needs verification");
    await pool.query(`UPDATE community_campaign_jobs SET status='completed',result=$3,lease_owner=NULL,lease_expires_at=NULL,updated_at=now() WHERE campaign_id=$1 AND lease_owner=$2 AND status='running' AND lease_expires_at>now()`,[job.campaign_id,lease,JSON.stringify({queued:result.sent,failed:result.failed,status:result.campaign.status})]);
   }catch(error){
    // A failed pre-launch is distinguishable from an uncertain external send.
    // Keep the campaign locked until the user explicitly cancels and reviews it.
    const code=diagnosticCode(error);
    workerDiagnostic(job.campaign_id,stage,code);
    await pool.query(`UPDATE community_campaign_jobs j SET status=CASE WHEN
     EXISTS (SELECT 1 FROM ai_campaigns c WHERE c.id=j.campaign_id AND c.status='scheduled' AND c.launched_at IS NULL)
     AND NOT EXISTS (SELECT 1 FROM ai_campaign_recipients r WHERE r.campaign_id=j.campaign_id AND (r.status<>'pending' OR r.send_id IS NOT NULL))
     AND NOT EXISTS (SELECT 1 FROM outbound_messages o WHERE o.account_id=j.account_id AND o.client_request_id LIKE 'campaign:'||j.campaign_id::text||':%')
     THEN 'failed' ELSE 'uncertain' END,
     result=$3::jsonb,lease_owner=NULL,lease_expires_at=NULL,updated_at=now() WHERE campaign_id=$1 AND lease_owner=$2 AND status='running'`,[job.campaign_id,lease,JSON.stringify({stage,code})]);
   }finally{clearInterval(heartbeat);}
  }catch(error){onError(error);}finally{busy=false;}
 };
 // A bounded, read-only startup preflight validates saved schedules without
 // drafting, queueing, rescheduling or sending any email.
 void (async()=>{
  const {rows}=await pool.query<Job>("SELECT * FROM community_campaign_jobs WHERE status IN ('queued','failed','uncertain') ORDER BY scheduled_at LIMIT 20");
  for(const job of rows){
   const owner={userId:job.user_id,authUserId:job.auth_user_id,clientId:job.client_id,accountId:job.account_id};
   let code="preflight_passed";
   try{await verifyScheduledReview(owner,job);}catch(error){code=diagnosticCode(error);}
   workerDiagnostic(job.campaign_id,"review",code);
   // Persist diagnostic evidence only, never change a schedule or delivery state.
   await pool.query(`UPDATE community_campaign_jobs SET result=jsonb_set(COALESCE(result,'{}'::jsonb),'{preflight}',$3::jsonb,true)
    WHERE campaign_id=$1 AND status=$2 AND status IN ('queued','failed','uncertain') AND lease_owner IS NULL`,
    [job.campaign_id,job.status,JSON.stringify({code,checkedAt:new Date().toISOString()})]);
  }
 })().catch(onError);
 const timer=setInterval(()=>void tick(),15000);timer.unref();void tick();
 return ()=>{stopped=true;clearInterval(timer);};
}
