import { randomUUID } from "node:crypto";
import { pool } from "../db/client.js";

export type ProposalReviewStatus = "submitted" | "triaged" | "accepted" | "rejected" | "resolved";

export async function ensureProposalConversationSchema(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ai_proposal_comments (
      id uuid PRIMARY KEY,
      proposal_id uuid NOT NULL REFERENCES ai_proposals(id) ON DELETE CASCADE,
      account_id text NOT NULL,
      author_user_id text NOT NULL,
      body text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS ai_proposal_comments_proposal_created_idx
      ON ai_proposal_comments(proposal_id,created_at);
    CREATE TABLE IF NOT EXISTS ai_proposal_status_events (
      id uuid PRIMARY KEY,
      proposal_id uuid NOT NULL REFERENCES ai_proposals(id) ON DELETE CASCADE,
      account_id text NOT NULL,
      actor_user_id text NOT NULL,
      previous_status text NOT NULL,
      new_status text NOT NULL,
      note text,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);
}

export async function getProposal(accountId: string, proposalId: string) {
  const result=await pool.query(`SELECT id,kind,priority,title,summary,evidence,suggested_action,related_tool,status,source_client,created_at
    FROM ai_proposals WHERE id=$1 AND account_id=$2`,[proposalId,accountId]);
  return result.rows[0] ?? null;
}

export async function listProposals(accountId: string, limit=20) {
  const result=await pool.query(`SELECT id,kind,priority,title,summary,status,created_at
    FROM ai_proposals WHERE account_id=$1 ORDER BY created_at DESC LIMIT $2`,[accountId,Math.max(1,Math.min(limit,50))]);
  return result.rows;
}

export async function addProposalComment(input:{ accountId:string; userId:string; proposalId:string; body:string }) {
  const body=input.body.trim();
  if (!body || body.length>10000) throw new Error("invalid_comment");
  const id=randomUUID();
  const result=await pool.query(`INSERT INTO ai_proposal_comments(id,proposal_id,account_id,author_user_id,body)
    SELECT $1,id,$2,$3,$4 FROM ai_proposals WHERE id=$5 AND account_id=$2 RETURNING id,created_at`,
    [id,input.accountId,input.userId,body,input.proposalId]);
  if (!result.rowCount) throw new Error("proposal_not_found");
  return result.rows[0];
}

export async function listProposalComments(accountId:string,proposalId:string) {
  if (!await getProposal(accountId,proposalId)) throw new Error("proposal_not_found");
  const result=await pool.query(`SELECT id,author_user_id,body,created_at FROM ai_proposal_comments
    WHERE account_id=$1 AND proposal_id=$2 ORDER BY created_at ASC LIMIT 200`,[accountId,proposalId]);
  return result.rows;
}

/** Review state is advisory; accepted proposals do NOT authorize changes or tool execution. */
export async function reviewProposal(input:{
 accountId:string; actorUserId:string; proposalId:string; status:ProposalReviewStatus; note?:string
}) {
  const valid:ProposalReviewStatus[]=["submitted","triaged","accepted","rejected","resolved"];
  if (!valid.includes(input.status) || (input.note?.length??0)>10000) throw new Error("invalid_review");
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    const locked=await client.query<{status:string}>(`SELECT status FROM ai_proposals WHERE id=$1 AND account_id=$2 FOR UPDATE`,
      [input.proposalId,input.accountId]);
    if(!locked.rowCount) throw new Error("proposal_not_found");
    const previous=locked.rows[0]!.status;
    await client.query(`UPDATE ai_proposals SET status=$3,updated_at=now() WHERE id=$1 AND account_id=$2`,
      [input.proposalId,input.accountId,input.status]);
    await client.query(`INSERT INTO ai_proposal_status_events
      (id,proposal_id,account_id,actor_user_id,previous_status,new_status,note)
      VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [randomUUID(),input.proposalId,input.accountId,input.actorUserId,previous,input.status,input.note??null]);
    await client.query("COMMIT");
    return {status:input.status,previousStatus:previous};
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}
