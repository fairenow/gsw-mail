import { randomUUID } from "node:crypto";
import { pool } from "../db/client.js";

export type ChatExecutionStatus = "queued" | "running" | "completed" | "uncertain" | "failed";
export type ChatExecution = {
  id: string; user_id: string; account_id: string | null; command_id: string;
  conversation_id: string | null; request: unknown; status: ChatExecutionStatus;
  attempts: number; lease_owner: string | null; result: unknown;
};

/** Enqueue exactly once per authenticated user + command. A conflicting payload is rejected. */
export async function enqueueChatExecution(input: {
  userId: string; accountId?: string; commandId: string; conversationId?: string; request: unknown;
}) {
  const id = randomUUID();
  const { rows } = await pool.query<ChatExecution>(
    `INSERT INTO ai_chat_executions (id,user_id,account_id,command_id,conversation_id,request)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (user_id,command_id) DO UPDATE SET updated_at = ai_chat_executions.updated_at
     WHERE ai_chat_executions.request = EXCLUDED.request
       AND ai_chat_executions.account_id IS NOT DISTINCT FROM EXCLUDED.account_id
     RETURNING *`,
    [id,input.userId,input.accountId ?? null,input.commandId,input.conversationId ?? null,JSON.stringify(input.request)],
  );
  if (!rows[0]) throw new Error("Command ID already used with different request content");
  return rows[0];
}

/** Atomically claim one queued execution across concurrent API replicas. */
export async function claimChatExecution(owner: string, leaseSeconds = 120) {
  const { rows } = await pool.query<ChatExecution>(
    `WITH candidate AS (
       SELECT id FROM ai_chat_executions WHERE status = 'queued'
       ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1
     )
     UPDATE ai_chat_executions e SET status='running', attempts=attempts+1,
       lease_owner=$1, lease_expires_at=now()+($2::integer * interval '1 second'),
       updated_at=now()
     FROM candidate WHERE e.id=candidate.id RETURNING e.*`,
    [owner,leaseSeconds],
  );
  return rows[0] ?? null;
}

export async function heartbeatChatExecution(id: string, owner: string, leaseSeconds = 120) {
  const { rowCount } = await pool.query(
    `UPDATE ai_chat_executions SET lease_expires_at=now()+($3::integer * interval '1 second'),
       updated_at=now() WHERE id=$1 AND lease_owner=$2 AND status='running'
       AND lease_expires_at > now()`,
    [id,owner,leaseSeconds],
  );
  return rowCount === 1;
}

export async function finishChatExecution(id: string, owner: string, status: "completed" | "uncertain" | "failed", result?: unknown, error?: string) {
  const { rowCount } = await pool.query(
    `UPDATE ai_chat_executions SET status=$3, result=$4, error=$5, lease_owner=NULL,
       lease_expires_at=NULL, completed_at=now(), updated_at=now()
       WHERE id=$1 AND lease_owner=$2 AND status='running' AND lease_expires_at > now()`,
    [id,owner,status,result === undefined ? null : JSON.stringify(result),error ?? null],
  );
  return rowCount === 1;
}

/** Expired work is marked uncertain, NOT replayed: tools may already have acted. */
export async function quarantineExpiredChatExecutions() {
  const { rowCount } = await pool.query(
    `UPDATE ai_chat_executions SET status='uncertain', lease_owner=NULL,
       lease_expires_at=NULL, updated_at=now(),
       error='Worker lease expired; inspect tool effects before retry'
       WHERE status='running' AND lease_expires_at < now()`,
  );
  return rowCount ?? 0;
}

export async function getChatExecution(userId: string, commandId: string) {
  const { rows } = await pool.query<ChatExecution>(
    "SELECT * FROM ai_chat_executions WHERE user_id=$1 AND command_id=$2 LIMIT 1",
    [userId,commandId],
  );
  return rows[0] ?? null;
}
