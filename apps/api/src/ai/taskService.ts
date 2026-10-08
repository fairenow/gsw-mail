import { and, asc, desc, eq, isNull, lt, lte, or } from "drizzle-orm";
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
  const terminal = ["completed", "failed", "cancelled"].includes(status);
  const [updated] = await db.update(aiTasks).set({
    ...(input.status !== undefined ? { status: input.status } : {}),
    ...(input.currentStep !== undefined ? { currentStep: Math.max(0, input.currentStep) } : {}),
    ...(input.progressPercent !== undefined ? { progressPercent: Math.min(100, Math.max(0, input.progressPercent)) } : {}),
    ...(input.lastError !== undefined ? { lastError: input.lastError?.slice(0, 2_000) ?? null } : {}),
    ...(input.metadata !== undefined ? { metadata: { ...(existing.metadata ?? {}), ...input.metadata } } : {}),
    ...(status === "running" ? { startedAt: existing.startedAt ?? now, runningAt: existing.runningAt ?? now } : {}),
    ...(status === "planned" || status === "waiting" ? { runningAt: null } : {}),
    ...(terminal ? { completedAt: now, runningAt: null } : {}),
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

export async function claimRunnableAgentTask(now = new Date(), staleMs = 15 * 60_000) {
  const staleBefore = new Date(now.getTime() - staleMs);
  const [candidate] = await db.select().from(aiTasks).where(or(
    eq(aiTasks.status, "planned"),
    and(
      eq(aiTasks.status, "running"),
      or(isNull(aiTasks.runningAt), lt(aiTasks.runningAt, staleBefore)),
    ),
  )).orderBy(asc(aiTasks.updatedAt)).limit(1);
  if (!candidate) return null;

  const [claimed] = await db.update(aiTasks).set({
    status: "running",
    startedAt: candidate.startedAt ?? now,
    runningAt: now,
    lastError: null,
    updatedAt: now,
  }).where(and(
    eq(aiTasks.id, candidate.id),
    eq(aiTasks.status, candidate.status),
    eq(aiTasks.updatedAt, candidate.updatedAt),
  )).returning();
  return claimed ?? null;
}

export async function claimRunnableTaskStep(taskId: string, now = new Date(), staleMs = 15 * 60_000) {
  const staleBefore = new Date(now.getTime() - staleMs);
  const [candidate] = await db.select().from(aiTaskSteps).where(and(
    eq(aiTaskSteps.taskId, taskId),
    or(
      and(
        eq(aiTaskSteps.status, "pending"),
        or(isNull(aiTaskSteps.nextAttemptAt), lte(aiTaskSteps.nextAttemptAt, now)),
      ),
      and(eq(aiTaskSteps.status, "running"), lt(aiTaskSteps.updatedAt, staleBefore)),
    ),
  )).orderBy(asc(aiTaskSteps.sequence)).limit(1);
  if (!candidate) return null;

  const [claimed] = await db.update(aiTaskSteps).set({
    status: "running",
    attempts: candidate.attempts + 1,
    nextAttemptAt: null,
    lastError: null,
    startedAt: candidate.startedAt ?? now,
    updatedAt: now,
  }).where(and(
    eq(aiTaskSteps.id, candidate.id),
    eq(aiTaskSteps.updatedAt, candidate.updatedAt),
  )).returning();
  return claimed ?? null;
}

export async function completeClaimedTaskStep(taskId: string, stepId: string, result: Record<string, unknown>) {
  const now = new Date();
  await db.update(aiTaskSteps).set({
    status: "completed",
    result,
    lastError: null,
    completedAt: now,
    updatedAt: now,
  }).where(and(eq(aiTaskSteps.id, stepId), eq(aiTaskSteps.taskId, taskId)));
  return recomputeAgentTask(taskId);
}

export async function failClaimedTaskStep(taskId: string, stepId: string, error: unknown) {
  const [step] = await db.select().from(aiTaskSteps)
    .where(and(eq(aiTaskSteps.id, stepId), eq(aiTaskSteps.taskId, taskId)))
    .limit(1);
  if (!step) throw notFound("agent task step not found");

  const now = new Date();
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 2_000);
  if (step.attempts < step.maxAttempts) {
    const backoffMs = Math.min(5 * 60_000, 15_000 * (2 ** Math.max(0, step.attempts - 1)));
    await db.transaction(async (tx) => {
      await tx.update(aiTaskSteps).set({
        status: "pending",
        nextAttemptAt: new Date(now.getTime() + backoffMs),
        lastError: message,
        updatedAt: now,
      }).where(eq(aiTaskSteps.id, stepId));
      await tx.update(aiTasks).set({
        status: "planned",
        runningAt: null,
        lastError: message,
        updatedAt: now,
      }).where(eq(aiTasks.id, taskId));
    });
    return { retrying: true, attempts: step.attempts, maxAttempts: step.maxAttempts };
  }

  await db.transaction(async (tx) => {
    await tx.update(aiTaskSteps).set({
      status: "failed",
      lastError: message,
      completedAt: now,
      updatedAt: now,
    }).where(eq(aiTaskSteps.id, stepId));
    await tx.update(aiTasks).set({
      status: "failed",
      runningAt: null,
      completedAt: now,
      lastError: message,
      updatedAt: now,
    }).where(eq(aiTasks.id, taskId));
  });
  return { retrying: false, attempts: step.attempts, maxAttempts: step.maxAttempts };
}

export async function setAgentTaskWaiting(taskId: string, reason: string, metadata?: Record<string, unknown>) {
  const now = new Date();
  const [task] = await db.select().from(aiTasks).where(eq(aiTasks.id, taskId)).limit(1);
  if (!task) throw notFound("agent task not found");
  await db.update(aiTasks).set({
    status: "waiting",
    runningAt: null,
    lastError: reason.slice(0, 2_000),
    ...(metadata ? { metadata: { ...(task.metadata ?? {}), ...metadata } } : {}),
    updatedAt: now,
  }).where(eq(aiTasks.id, taskId));
}

export async function recomputeAgentTask(taskId: string) {
  const steps = await db.select().from(aiTaskSteps)
    .where(eq(aiTaskSteps.taskId, taskId))
    .orderBy(asc(aiTaskSteps.sequence));
  const now = new Date();

  if (steps.length === 0) {
    await db.update(aiTasks).set({
      status: "waiting",
      runningAt: null,
      lastError: "This task has no executable steps yet.",
      updatedAt: now,
    }).where(eq(aiTasks.id, taskId));
    return;
  }

  if (steps.some((step) => step.status === "failed")) {
    await db.update(aiTasks).set({
      status: "failed",
      runningAt: null,
      completedAt: now,
      lastError: steps.find((step) => step.status === "failed")?.lastError ?? "A task step failed.",
      updatedAt: now,
    }).where(eq(aiTasks.id, taskId));
    return;
  }

  if (steps.some((step) => step.status === "waiting")) {
    await db.update(aiTasks).set({
      status: "waiting",
      runningAt: null,
      updatedAt: now,
    }).where(eq(aiTasks.id, taskId));
    return;
  }

  const completed = steps.filter((step) => step.status === "completed" || step.status === "skipped").length;
  const progressPercent = Math.round((completed / steps.length) * 100);
  if (completed === steps.length) {
    await db.update(aiTasks).set({
      status: "completed",
      currentStep: steps.length,
      progressPercent: 100,
      runningAt: null,
      completedAt: now,
      lastError: null,
      updatedAt: now,
    }).where(eq(aiTasks.id, taskId));
    return;
  }

  const next = steps.find((step) => step.status === "pending" || step.status === "running");
  await db.update(aiTasks).set({
    status: "planned",
    currentStep: next?.sequence ?? completed,
    progressPercent,
    runningAt: null,
    updatedAt: now,
  }).where(eq(aiTasks.id, taskId));
}
