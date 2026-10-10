import { randomUUID } from "node:crypto";
import { pool } from "../db/client.js";
import { getRelay } from "../outbound/relay.js";

export async function ensureAutomationSummaryEmailSchema(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS automation_summary_email_preferences (
      automation_id uuid PRIMARY KEY REFERENCES ai_automations(id) ON DELETE CASCADE,
      account_id uuid NOT NULL REFERENCES email_accounts(id) ON DELETE CASCADE,
      enabled boolean NOT NULL DEFAULT false
    );
    CREATE TABLE IF NOT EXISTS automation_summary_email_deliveries (
      run_id uuid PRIMARY KEY REFERENCES ai_automation_runs(id) ON DELETE CASCADE,
      automation_id uuid NOT NULL REFERENCES ai_automations(id) ON DELETE CASCADE,
      status text NOT NULL CHECK(status IN ('sending','accepted','failed')),
      delivery_id text,
      error text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `);
}

export async function setAutomationSummaryEmailPreference(automationId:string,accountId:string,enabled:boolean):Promise<void> {
  await pool.query(`INSERT INTO automation_summary_email_preferences(automation_id,account_id,enabled)
    VALUES($1,$2,$3) ON CONFLICT(automation_id) DO UPDATE SET enabled=EXCLUDED.enabled,account_id=EXCLUDED.account_id`,
    [automationId,accountId,enabled]);
}

export async function deliverAutomationSummaryEmail(input:{
  automationId:string; runId:string; accountId:string; title:string; summary:string;
}):Promise<"disabled"|"accepted"|"already_attempted"> {
  const relay=getRelay();
  const client=await pool.connect();
  let address:string|undefined;
  try {
    await client.query("BEGIN");
    const preference=await client.query<{address:string}>(`
      SELECT a.address FROM automation_summary_email_preferences p
      JOIN email_accounts a ON a.id=p.account_id
      WHERE p.automation_id=$1 AND p.account_id=$2 AND p.enabled=true`,[input.automationId,input.accountId]);
    address=preference.rows[0]?.address;
    if(!address){await client.query("COMMIT");return "disabled";}
    if(relay.name==="null") throw new Error("No real email relay configured for automation summaries");
    const claimed=await client.query(`
      INSERT INTO automation_summary_email_deliveries(run_id,automation_id,status)
      VALUES($1,$2,'sending') ON CONFLICT(run_id) DO NOTHING RETURNING run_id`,
      [input.runId,input.automationId]);
    await client.query("COMMIT");
    if(!claimed.rowCount)return "already_attempted";
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
  try {
    const result=await relay.send({
      id:randomUUID(),accountId:input.accountId,fromAddress:address,to:[address],
      subject:`GSW inbox summary: ${input.title}`.slice(0,200),
      textBody:input.summary.slice(0,50_000)
    });
    if(!result.accepted)throw new Error(result.message??"Relay rejected scheduled summary");
    await pool.query("UPDATE automation_summary_email_deliveries SET status='accepted',delivery_id=$2,updated_at=now() WHERE run_id=$1",
      [input.runId,result.deliveryId??null]);
    return "accepted";
  }catch(error){
    await pool.query("UPDATE automation_summary_email_deliveries SET status='failed',error=$2,updated_at=now() WHERE run_id=$1",
      [input.runId,error instanceof Error?error.message:String(error)]);
    throw error;
  }
}
