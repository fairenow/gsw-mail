import { createHash, randomUUID } from "node:crypto";
import { pool } from "../db/client.js";

const hashInput = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

export type ExecutionStep = {
  id: string; execution_id: string; step_key: string; kind: string;
  status: "started" | "completed" | "uncertain" | "failed";
  input_fingerprint: string; result: unknown;
};

/**
 * Reserve a deterministic step key before a side-effecting tool runs.
 * Only a newly inserted step may execute. Existing steps must be inspected
 * rather than executed again, including after a process restart.
 */
export async function reserveExecutionStep(input: {
  executionId: string; stepKey: string; kind: string; payload: unknown;
}) {
  const fingerprint = hashInput(input.payload);
  const { rows: inserted } = await pool.query<ExecutionStep>(
    `INSERT INTO ai_chat_execution_steps
       (id,execution_id,step_key,kind,status,input_fingerprint)
     VALUES ($1,$2,$3,$4,'started',$5)
     ON CONFLICT (execution_id,step_key) DO NOTHING RETURNING *`,
    [randomUUID(),input.executionId,input.stepKey,input.kind,fingerprint],
  );
  if (inserted[0]) return { isNew: true as const, step: inserted[0] };
  const { rows } = await pool.query<ExecutionStep>(
    "SELECT * FROM ai_chat_execution_steps WHERE execution_id=$1 AND step_key=$2",
    [input.executionId,input.stepKey],
  );
  const step = rows[0];
  if (!step || step.input_fingerprint !== fingerprint || step.kind !== input.kind) {
    throw new Error("Execution step key reused with different tool input");
  }
  return { isNew: false as const, step };
}

/** Persist a completed step; the same step key cannot be completed twice. */
export async function completeExecutionStep(input: {
  executionId: string; stepKey: string; result: unknown;
}) {
  const { rows } = await pool.query<ExecutionStep>(
    `UPDATE ai_chat_execution_steps SET status='completed', result=$3,
       updated_at=now()
     WHERE execution_id=$1 AND step_key=$2 AND status='started'
     RETURNING *`,
    [input.executionId,input.stepKey,JSON.stringify(input.result)],
  );
  return rows[0] ?? null;
}

/** A started step is never automatically replayed after uncertain execution. */
export async function getExecutionSteps(executionId: string) {
  const { rows } = await pool.query<ExecutionStep>(
    "SELECT * FROM ai_chat_execution_steps WHERE execution_id=$1 ORDER BY created_at",
    [executionId],
  );
  return rows;
}
