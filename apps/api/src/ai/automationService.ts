import { and, desc, eq, isNull, lt, lte, or } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  aiAutomationRuns,
  aiAutomations,
  aiConversations,
  aiMessages,
} from "../db/schema.js";
import { badRequest, notFound } from "../lib/errors.js";
import { computeNextAutomationRun, type AutomationSchedule } from "./automationSchedule.js";

export interface CreateAutomationInput {
  userId: string;
  accountId?: string | undefined;
  sourceConversationId?: string | undefined;
  title: string;
  instruction: string;
  timeZone: string;
  schedule: AutomationSchedule;
  allowedScopes?: string[] | undefined;
}

export async function createAutomation(input: CreateAutomationInput) {
  const nextRunAt = computeNextAutomationRun(input.schedule, input.timeZone);
  if (!nextRunAt) throw badRequest("automation schedule has no future run");

  const [conversation] = await db.insert(aiConversations).values({
    userId: input.userId,
    accountId: input.accountId ?? null,
    title: `Scheduled: ${input.title.trim().slice(0, 100)}`,
    status: "active",
    lastMessageAt: new Date(),
  }).returning();
  if (!conversation) throw new Error("failed to create automation conversation");

  await db.insert(aiMessages).values({
    conversationId: conversation.id,
    role: "user",
    content: `Scheduled task: ${input.instruction.trim()}`,
    metadata: {
      kind: "automation_definition",
      sourceConversationId: input.sourceConversationId ?? null,
      timeZone: input.timeZone,
      schedule: input.schedule,
    },
  });

  const [automation] = await db.insert(aiAutomations).values({
    userId: input.userId,
    accountId: input.accountId ?? null,
    conversationId: conversation.id,
    title: input.title.trim().slice(0, 120),
    instruction: input.instruction.trim(),
    status: "active",
    timeZone: input.timeZone,
    schedule: input.schedule,
    allowedScopes: input.allowedScopes ?? ["mail.read"],
    nextRunAt,
  }).returning();
  if (!automation) throw new Error("failed to create automation");
  return automation;
}

export async function listAutomations(userId: string) {
  return db.select().from(aiAutomations)
    .where(eq(aiAutomations.userId, userId))
    .orderBy(desc(aiAutomations.createdAt));
}

export async function getAutomation(userId: string, id: string) {
  const [automation] = await db.select().from(aiAutomations).where(and(
    eq(aiAutomations.id, id),
    eq(aiAutomations.userId, userId),
  )).limit(1);
  if (!automation) throw notFound("automation not found");
  return automation;
}

export async function updateAutomation(userId: string, id: string, input: {
  title?: string | undefined;
  instruction?: string | undefined;
  status?: "active" | "paused" | "archived" | undefined;
  timeZone?: string | undefined;
  schedule?: AutomationSchedule | undefined;
}) {
  const existing = await getAutomation(userId, id);
  const nextSchedule = input.schedule ?? existing.schedule;
  const nextTimeZone = input.timeZone ?? existing.timeZone;
  const nextStatus = input.status ?? existing.status;

  const nextRunAt = nextStatus === "active"
    ? computeNextAutomationRun(nextSchedule, nextTimeZone)
    : existing.nextRunAt;

  if (nextStatus === "active" && !nextRunAt) throw badRequest("automation schedule has no future run");

  const [updated] = await db.update(aiAutomations).set({
    ...(input.title !== undefined ? { title: input.title.trim().slice(0, 120) } : {}),
    ...(input.instruction !== undefined ? { instruction: input.instruction.trim() } : {}),
    ...(input.status !== undefined ? { status: input.status } : {}),
    ...(input.timeZone !== undefined ? { timeZone: input.timeZone } : {}),
    ...(input.schedule !== undefined ? { schedule: input.schedule } : {}),
    ...(nextRunAt ? { nextRunAt } : {}),
    runningAt: null,
    lastError: null,
    updatedAt: new Date(),
  }).where(and(
    eq(aiAutomations.id, id),
    eq(aiAutomations.userId, userId),
  )).returning();
  if (!updated) throw notFound("automation not found");
  return updated;
}

export async function deleteAutomation(userId: string, id: string) {
  const [deleted] = await db.delete(aiAutomations).where(and(
    eq(aiAutomations.id, id),
    eq(aiAutomations.userId, userId),
  )).returning({ id: aiAutomations.id });
  if (!deleted) throw notFound("automation not found");
  return deleted;
}

export async function listAutomationRuns(userId: string, automationId: string, limit = 25) {
  await getAutomation(userId, automationId);
  return db.select().from(aiAutomationRuns)
    .where(eq(aiAutomationRuns.automationId, automationId))
    .orderBy(desc(aiAutomationRuns.startedAt))
    .limit(Math.min(Math.max(limit, 1), 100));
}

export async function claimDueAutomation(now = new Date()) {
  const staleBefore = new Date(now.getTime() - 15 * 60_000);
  const [candidate] = await db.select().from(aiAutomations).where(and(
    eq(aiAutomations.status, "active"),
    lte(aiAutomations.nextRunAt, now),
    or(isNull(aiAutomations.runningAt), lt(aiAutomations.runningAt, staleBefore)),
  )).orderBy(aiAutomations.nextRunAt).limit(1);
  if (!candidate) return null;

  const [claimed] = await db.update(aiAutomations).set({
    runningAt: now,
    updatedAt: now,
  }).where(and(
    eq(aiAutomations.id, candidate.id),
    eq(aiAutomations.status, "active"),
    lte(aiAutomations.nextRunAt, now),
    or(isNull(aiAutomations.runningAt), lt(aiAutomations.runningAt, staleBefore)),
  )).returning();
  return claimed ?? null;
}

export async function beginAutomationRun(automationId: string, conversationId?: string | null) {
  const [run] = await db.insert(aiAutomationRuns).values({
    automationId,
    conversationId: conversationId ?? null,
    status: "running",
  }).returning();
  if (!run) throw new Error("failed to create automation run");
  return run;
}

export async function completeAutomationRun(input: {
  automationId: string;
  runId: string;
  schedule: AutomationSchedule;
  timeZone: string;
  result: string;
  conversationId?: string | null;
}) {
  const now = new Date();
  const nextRunAt = computeNextAutomationRun(input.schedule, input.timeZone, now);
  await db.transaction(async (tx) => {
    await tx.update(aiAutomationRuns).set({
      status: "completed",
      result: input.result,
      completedAt: now,
      updatedAt: now,
    }).where(eq(aiAutomationRuns.id, input.runId));

    await tx.update(aiAutomations).set({
      status: nextRunAt ? "active" : "completed",
      nextRunAt: nextRunAt ?? now,
      lastRunAt: now,
      runningAt: null,
      lastError: null,
      ...(input.conversationId ? { conversationId: input.conversationId } : {}),
      updatedAt: now,
    }).where(eq(aiAutomations.id, input.automationId));
  });
}

export async function failAutomationRun(input: {
  automationId: string;
  runId: string;
  schedule: AutomationSchedule;
  timeZone: string;
  error: unknown;
}) {
  const now = new Date();
  const message = input.error instanceof Error ? input.error.message : String(input.error);
  const nextRunAt = computeNextAutomationRun(input.schedule, input.timeZone, new Date(now.getTime() + 60_000));
  await db.transaction(async (tx) => {
    await tx.update(aiAutomationRuns).set({
      status: "failed",
      errorMessage: message.slice(0, 4000),
      completedAt: now,
      updatedAt: now,
    }).where(eq(aiAutomationRuns.id, input.runId));

    await tx.update(aiAutomations).set({
      status: nextRunAt ? "active" : "failed",
      nextRunAt: nextRunAt ?? now,
      lastRunAt: now,
      runningAt: null,
      lastError: message.slice(0, 4000),
      updatedAt: now,
    }).where(eq(aiAutomations.id, input.automationId));
  });
}
