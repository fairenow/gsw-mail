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
  // Authentication credentials, access tokens and request headers must never be
  // serialized into the durable execution queue.
  if (!input.request || typeof input.request !== "object" || Array.isArray(input.request)) {
    throw new Error("Chat execution request must be a structured payload");
  }
  const unsafe = ["headers", "authorization", "accessToken", "refreshToken", "cookie", "password", "apiKey"];
  const keys = Object.keys(input.request as Record<string, unknown>);
  if (keys.some(key => unsafe.some(secret => key.toLowerCase() === secret.toLowerCase()))) {
    throw new Error("Chat execution request cannot persist authentication credentials");
  }
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

/** Atomically commit exactly one assistant message and the completed model-only job. */
export async function commitModelOnlyChatResult(input:{
  executionId:string; owner:string; conversationId:string;
  content:string;provider:string;model:string;response:unknown;
}) {
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    const {rows}=await client.query<{id:string}>(
      `SELECT id FROM ai_chat_executions
       WHERE id=$1 AND lease_owner=$2 AND status='running'
         AND lease_expires_at>now() AND account_id IS NULL
         AND request->>'kind'='model_only' FOR UPDATE`,
      [input.executionId,input.owner],
    );
    if(!rows[0]) { await client.query("ROLLBACK");return false; }
    // Execution UUID doubles as its unique assistant-message UUID.
    // A committed reply and its status can never be separated by a crash.
    await client.query(
      `INSERT INTO ai_messages(id,conversation_id,role,content,provider,model)
       VALUES($1,$2,'assistant',$3,$4,$5) ON CONFLICT(id) DO NOTHING`,
      [input.executionId,input.conversationId,input.content,input.provider,input.model],
    );
    await client.query(
      "UPDATE ai_conversations SET updated_at=now(),last_message_at=now() WHERE id=$1",
      [input.conversationId],
    );
    await client.query(
      `UPDATE ai_chat_executions SET status='completed',result=$3::jsonb,
       lease_owner=NULL,lease_expires_at=NULL,completed_at=now(),updated_at=now()
       WHERE id=$1 AND lease_owner=$2`,
      [input.executionId,input.owner,JSON.stringify(input.response)],
    );
    await client.query("COMMIT");
    return true;
  }catch(error){
    await client.query("ROLLBACK");
    throw error;
  }finally{client.release();}
}

/** Expired work is marked uncertain, NOT replayed: tools may already have acted. */
export async function quarantineExpiredChatExecutions() {
  // Persist the outcome of every incomplete step before releasing the lease.
  // Both updates run in one transaction to avoid losing the recovery audit trail.
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<{ id: string }>(
      `SELECT id FROM ai_chat_executions
       WHERE status='running' AND lease_expires_at < now()
       FOR UPDATE SKIP LOCKED`,
    );
    const ids = rows.map(row => row.id);
    // Pure inference has no external tool effects. Safely requeue after a
    // process restart; the completed response transaction prevents duplicates.
    const retried=await client.query<{id:string}>(
      `UPDATE ai_chat_executions SET status='queued',lease_owner=NULL,
       lease_expires_at=NULL,updated_at=now()
       WHERE id=ANY($1::uuid[]) AND status='running'
       AND request->>'kind'='model_only' AND attempts<3
       AND NOT EXISTS(SELECT 1 FROM ai_chat_execution_steps s
                      WHERE s.execution_id=ai_chat_executions.id)
       RETURNING id`,
      [ids],
    );
    const retryIds=new Set(retried.rows.map(row=>row.id));
    const unsafeIds=ids.filter(id=>!retryIds.has(id));
    if (!unsafeIds.length) { await client.query("COMMIT"); return retryIds.size; }
    await client.query(
      `UPDATE ai_chat_execution_steps SET status='uncertain', updated_at=now()
       WHERE execution_id=ANY($1::uuid[]) AND status='started'`,
      [unsafeIds],
    );
    const result = await client.query(
      `UPDATE ai_chat_executions SET status='uncertain', lease_owner=NULL,
       lease_expires_at=NULL, updated_at=now(),
       error='Worker lease expired; inspect tool effects before retry'
       WHERE id=ANY($1::uuid[]) AND status='running'`,
      [unsafeIds],
    );
    await client.query("COMMIT");
    return (result.rowCount ?? 0)+retryIds.size;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * A running execution is recoverable only if every started tool step has
 * a durable completed checkpoint. Otherwise, quarantine for manual review.
 * This is a conservative classification; it never replays tool effects.
 */
export async function inspectExpiredChatExecutions() {
  const { rows } = await pool.query<{ id: string; incomplete_steps: number }>(
    `SELECT e.id, count(s.id)::integer AS incomplete_steps
     FROM ai_chat_executions e
     LEFT JOIN ai_chat_execution_steps s
       ON s.execution_id=e.id AND s.status <> 'completed'
     WHERE e.status='running' AND e.lease_expires_at < now()
     GROUP BY e.id`,
  );
  return rows;
}

export async function getChatExecution(userId: string, commandId: string) {
  const { rows } = await pool.query<ChatExecution>(
    "SELECT * FROM ai_chat_executions WHERE user_id=$1 AND command_id=$2 LIMIT 1",
    [userId,commandId],
  );
  return rows[0] ?? null;
}
