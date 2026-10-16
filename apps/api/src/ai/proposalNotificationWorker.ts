import { pool } from "../db/client.js";
import { deliverProposalNotification } from "./proposalStore.js";

/**
 * Processes queued proposal notifications. The underlying sender atomically
 * claims each pending proposal; concurrent workers skip already claimed rows.
 * "sending" entries are held for operator reconciliation rather than retried
 * blindly (avoid sending duplicates after a relay timeout).
 */
export async function processPendingProposalNotifications(limit=10):Promise<number> {
  const result=await pool.query<{id:string}>(`
    SELECT id FROM ai_proposals
    WHERE notification_status = 'pending'
    ORDER BY created_at ASC LIMIT $1
  `,[Math.max(1,Math.min(limit,50))]);
  let accepted=0;
  for(const {id} of result.rows){
    if(await deliverProposalNotification(id)) accepted++;
  }
  return accepted;
}

export function startProposalNotificationWorker(log:(error:unknown)=>void):()=>void {
  const process=()=>void processPendingProposalNotifications().catch(log);
  process();
  const timer=setInterval(process,60_000);
  timer.unref();
  return ()=>clearInterval(timer);
}
