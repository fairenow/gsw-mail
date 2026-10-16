import { randomUUID } from "node:crypto";
import { pool } from "../db/client.js";
import { getRelay } from "../outbound/relay.js";
import { PROPOSAL_NOTIFICATION_RECIPIENT, renderProposalNotification, type McpProposal } from "../mcp/proposalContract.js";

export async function ensureProposalSchema(): Promise<void> {
  await pool.query(`CREATE TABLE IF NOT EXISTS ai_proposals (
    id uuid PRIMARY KEY, user_id text NOT NULL, account_id text NOT NULL,
    source_client text NOT NULL, kind text NOT NULL, priority text NOT NULL,
    title text NOT NULL, summary text NOT NULL, evidence text, suggested_action text, related_tool text,
    status text NOT NULL DEFAULT 'submitted',
    notification_status text NOT NULL DEFAULT 'pending',
    notification_error text, created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  ); CREATE INDEX IF NOT EXISTS ai_proposals_account_created_idx ON ai_proposals(account_id,created_at DESC);`);
}

/** Same operation from built-in GSW chat and remote MCP calls. */
export async function submitAiProposal(proposal: McpProposal & { accountId: string }): Promise<{ id: string; notificationStatus: string }> {
  const id = randomUUID();
  await pool.query(`INSERT INTO ai_proposals
    (id,user_id,account_id,source_client,kind,priority,title,summary,evidence,suggested_action,related_tool)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [
    id,proposal.requesterUserId,proposal.accountId,proposal.sourceClient,proposal.kind,proposal.priority,
    proposal.title,proposal.summary,proposal.evidence ?? null,proposal.suggestedAction ?? null,proposal.relatedTool ?? null,
  ]);
  return { id, notificationStatus: "pending" };
}

/** The sender mailbox must belong to the same permitted GSW account as the proposing user. */
export async function deliverProposalNotification(id: string): Promise<boolean> {
  const claim = await pool.query<{ id:string; account_id:string; user_id:string; source_client:string; kind:string; priority:string; title:string; summary:string; evidence:string|null; suggested_action:string|null; related_tool:string|null; from_address:string }>(`
    UPDATE ai_proposals SET notification_status='sending',updated_at=now()
    WHERE id=$1 AND notification_status IN ('pending','failed')
    RETURNING id, account_id,user_id,source_client,kind,priority,title,summary,evidence,suggested_action,related_tool`,[id]);
  const record = claim.rows[0];
  if (!record) return false;
  try {
    const sender = await pool.query<{address:string}>(`SELECT address FROM email_accounts WHERE id=$1`,[record.account_id]);
    if (!sender.rows[0]) throw new Error("Authorized sender mailbox unavailable");
    const message = renderProposalNotification({
      requesterUserId:record.user_id,sourceClient:record.source_client,
      kind:record.kind as McpProposal["kind"],priority:record.priority as McpProposal["priority"],
      title:record.title,summary:record.summary,evidence:record.evidence??undefined,
      suggestedAction:record.suggested_action??undefined,relatedTool:record.related_tool??undefined
    });
    const result = await getRelay().send({
      id:randomUUID(),accountId:record.account_id,fromAddress:sender.rows[0].address,
      to:[PROPOSAL_NOTIFICATION_RECIPIENT],subject:message.subject,textBody:message.text,
    });
    if (!result.accepted) throw new Error("Notification not accepted by email relay");
    await pool.query("UPDATE ai_proposals SET notification_status='accepted',notification_error=NULL,updated_at=now() WHERE id=$1",[id]);
    return true;
  } catch(error) {
    await pool.query("UPDATE ai_proposals SET notification_status='failed',notification_error=$2,updated_at=now() WHERE id=$1",
      [id,error instanceof Error?error.message:"Delivery failed"]);
    return false;
  }
}
