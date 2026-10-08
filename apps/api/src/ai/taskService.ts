import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { aiTasks, aiTaskSteps } from "../db/schema.js";
import { notFound } from "../lib/errors.js";
import type { AgentWorkerId } from "./skills.js";

export type AgentTaskStatus = "planned" | "running" | "waiting" | "completed" | "failed" | "cancelled";
export type AgentTaskStepStatus = "pending" | "running" | "waiting" | "completed" | "failed" | "skipped";

export interface AgentTaskStepInput {
  title: string;
  worker?: AgentWorkerId;
  input?: Record<string, unknown>;
}

export async function createAgentTask(input: {
  userId: string;
  accountId?: string;
  conversationId?: string;
  title: string;
  instruction: string;
  worker?: AgentWorkerId;
  selectedSkills?: string[];
  steps?: AgentTaskStepInput[];
  metadata?: Record<string, unknown>;
}) {
  return db.transaction(async (tx) => {
    const [task] = await tx.insert(aiTasks).values({
      userId: input.userId,
      accountId: input.accountId ?? null,
      conversationId: input.conversationId ?? null,
      title: input.title.trim().slice(0, 160),
      instruction: input.instruction.trim().slice(0, 30_000),
      worker: input.worker ?? "coordinator",
      selectedSkills: input.selectedSkills ?? [],
      metadata: input.metadata ?? {},
      status: "planned",
    }).returning();
    if (!task) throw new Error("failed to create agent task");

    const steps = (input.steps ?? []).slice(0, 50);
    if (steps.length) {
      await tx.insert(aiTaskSteps).values(steps.map((step, index) => ({
        taskId: task.id,
        sequence: index,
        title: step.title.trim().slice(0, 300),
        worker: step.worker ?? "coordinator",
        input: step.input ?? {},
      })));
    }

    return task;
  });
}

export async function listAgentTasks(userId: string, limit = 30) {
  return db.select().from(aiTasks)
    .where(eq(aiTasks.userId, userId))
    .orderBy(desc(aiTasks.updatedAt))
    .limit(Math.min(Math.max(limit, 1), 100));
}

export async function getAgentTask(userId: string, taskId: string) {
  const [task] = await db.select().from(aiTasks)
    .where(and(eq(aiTasks.id, taskId), eq(aiTasks.userId, userId)))
    .limit(1);
  if (!task) throw notFound("agent task not found");
  const steps = await db.select().from(aiTaskSteps)
    .where(eq(aiTaskSteps.taskId, task.id))
    .orderBy(asc(aiTaskSteps.sequence));
  return { task, steps };
}

export async function updateAgentTask(userId: string, taskId: string, input: {
  status?: AgentTaskStatus;
  currentStep?: number;
  progressPercent?: number;
  lastError?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const [existing] = await db.select().from(aiTasks)
    .where(and(eq(aiTasks.id, taskId), eq(aiTasks.userId, userId)))
    .limit(1);
  if (!existing) throw notFound("agent task not found");

  const now = new Date();
  const status = input.status ?? existing.status;
  const [updated] = await db.update(aiTasks).set({
    ...(input.status !== undefined ? { status: input.status } : {}),
    ...(input.currentStep !== undefined ? { currentStep: Math.max(0, input.currentStep) } : {}),
    ...(input.progressPercent !== undefined ? { progressPercent: Math.min(100, Math.max(0, input.progressPercent)) } : {}),
    ...(input.lastError !== undefined ? { lastError: input.lastError?.slice(0, 2_000) ?? null } : {}),
    ...(input.metadata !== undefined ? { metadata: { ...(existing.metadata ?? {}), ...input.metadata } } : {}),
    ...(status === "running" && !existing.startedAt ? { startedAt: now } : {}),
    ...(["completed", "failed", "cancelled"].includes(status) ? { completedAt: now } : {}),
    updatedAt: now,
  }).where(eq(aiTasks.id, taskId)).returning();
  return updated!;
}

export async function updateAgentTaskStep(userId: string, taskId: string, sequence: number, input: {
  status?: AgentTaskStepStatus;
  result?: Record<string, unknown> | null;
}) {
  await getAgentTask(userId, taskId);
  const [existing] = await db.select().from(aiTaskSteps)
    .where(and(eq(aiTaskSteps.taskId, taskId), eq(aiTaskSteps.sequence, sequence)))
    .limit(1);
  if (!existing) throw notFound("agent task step not found");

  const now = new Date();
  const status = input.status ?? existing.status;
  const [updated] = await db.update(aiTaskSteps).set({
    ...(input.status !== undefined ? { status: input.status } : {}),
    ...(input.result !== undefined ? { result: input.result } : {}),
    ...(status === "running" && !existing.startedAt ? { startedAt: now } : {}),
    ...(["completed", "failed", "skipped"].includes(status) ? { completedAt: now } : {}),
    updatedAt: now,
  }).where(eq(aiTaskSteps.id, existing.id)).returning();
  return updated!;
}
