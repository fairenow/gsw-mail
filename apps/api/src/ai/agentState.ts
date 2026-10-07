import { and, desc, eq, isNull, or } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  aiConfirmations,
  aiConversations,
  aiMessages,
  aiPermissionGrants,
  aiRuns,
  aiToolCalls,
  aiToolResults,
} from "../db/schema.js";
import { badRequest, notFound } from "../lib/errors.js";

const titleFromMessage = (content: string): string => {
  const compact = content.replace(/\s+/g, " ").trim();
  return compact.length > 72 ? `${compact.slice(0, 69)}…` : compact || "New chat";
};

export async function createOrResumeConversation(input: {
  userId: string;
  conversationId?: string;
  accountId?: string;
  firstMessage: string;
}) {
  if (input.conversationId) {
    const [existing] = await db.select().from(aiConversations).where(and(
      eq(aiConversations.id, input.conversationId),
      eq(aiConversations.userId, input.userId),
    )).limit(1);
    if (!existing) throw notFound("AI conversation not found");
    if (existing.accountId && input.accountId && existing.accountId !== input.accountId) {
      throw badRequest("AI conversation belongs to a different mailbox");
    }
    if (!existing.accountId && input.accountId) {
      const [updated] = await db.update(aiConversations).set({
        accountId: input.accountId,
        lastMessageAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(aiConversations.id, existing.id)).returning();
      return updated ?? existing;
    }
    return existing;
  }

  const [created] = await db.insert(aiConversations).values({
    userId: input.userId,
    accountId: input.accountId ?? null,
    title: titleFromMessage(input.firstMessage),
    status: "active",
    lastMessageAt: new Date(),
  }).returning();
  if (!created) throw new Error("failed to create AI conversation");
  return created;
}

export async function appendAiMessage(input: {
  conversationId: string;
  role: "user" | "assistant" | "system";
  content: string;
  provider?: string;
  model?: string;
  metadata?: Record<string, unknown>;
}) {
  const [message] = await db.insert(aiMessages).values({
    conversationId: input.conversationId,
    role: input.role,
    content: input.content,
    provider: input.provider ?? null,
    model: input.model ?? null,
    metadata: input.metadata ?? null,
  }).returning();
  await db.update(aiConversations).set({
    lastMessageAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(aiConversations.id, input.conversationId));
  return message;
}

export async function startAiRun(input: {
  conversationId: string;
  userId: string;
  accountId?: string;
  provider: string;
  model?: string;
  metadata?: Record<string, unknown>;
}) {
  const [run] = await db.insert(aiRuns).values({
    conversationId: input.conversationId,
    userId: input.userId,
    accountId: input.accountId ?? null,
    provider: input.provider,
    model: input.model ?? null,
    status: "running",
    metadata: input.metadata ?? null,
  }).returning();
  if (!run) throw new Error("failed to create AI run");
  return run;
}

export async function completeAiRun(runId: string, input: {
  model?: string;
  metadata?: Record<string, unknown>;
}) {
  await db.update(aiRuns).set({
    status: "completed",
    model: input.model ?? null,
    completedAt: new Date(),
    metadata: input.metadata ?? null,
    updatedAt: new Date(),
  }).where(eq(aiRuns.id, runId));
}

export async function failAiRun(runId: string, error: unknown) {
  await db.update(aiRuns).set({
    status: "failed",
    completedAt: new Date(),
    errorCode: error instanceof Error ? error.name : "unknown_error",
    errorMessage: error instanceof Error ? error.message.slice(0, 2_000) : String(error).slice(0, 2_000),
    updatedAt: new Date(),
  }).where(eq(aiRuns.id, runId));
}

const parseArguments = (raw: string): Record<string, unknown> => {
  try {
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : { value: parsed };
  } catch {
    return { invalidJson: true };
  }
};

const sanitizeToolArguments = (toolName: string, raw: string): Record<string, unknown> => {
  const parsed = parseArguments(raw);
  if (toolName === "mail.search") {
    return {
      mailbox: typeof parsed.mailbox === "string" ? parsed.mailbox : undefined,
      queryLength: typeof parsed.query === "string" ? parsed.query.length : 0,
    };
  }
  if (toolName === "mail.read") return { messageId: parsed.messageId };
  if (toolName === "mail.read_thread") return { threadId: parsed.threadId };
  return { argumentKeys: Object.keys(parsed).slice(0, 30) };
};

const sanitizeToolResult = (data: unknown): Record<string, unknown> | null => {
  if (!data || typeof data !== "object") return data === undefined ? null : { valueType: typeof data };
  const value = data as Record<string, unknown>;
  const summary: Record<string, unknown> = {};
  if (typeof value.count === "number") summary.count = value.count;
  if (typeof value.messageId === "string") summary.messageId = value.messageId;
  if (typeof value.threadId === "string") summary.threadId = value.threadId;
  if (Array.isArray(value.messages)) {
    summary.messageIds = value.messages
      .map((item) => item && typeof item === "object" ? (item as Record<string, unknown>).messageId : undefined)
      .filter((item): item is string => typeof item === "string")
      .slice(0, 50);
  }
  if (Object.keys(summary).length === 0) summary.resultKeys = Object.keys(value).slice(0, 30);
  return summary;
};

export async function recordAiToolCall(input: {
  runId: string;
  conversationId: string;
  providerToolCallId: string;
  toolName: string;
  risk: string;
  requiredScopes: string[];
  argumentsJson: string;
}) {
  const [call] = await db.insert(aiToolCalls).values({
    runId: input.runId,
    conversationId: input.conversationId,
    providerToolCallId: input.providerToolCallId,
    toolName: input.toolName,
    risk: input.risk,
    requiredScopes: input.requiredScopes,
    arguments: sanitizeToolArguments(input.toolName, input.argumentsJson),
    status: "running",
    startedAt: new Date(),
  }).returning();
  if (!call) throw new Error("failed to record AI tool call");
  return call;
}

export async function recordAiToolResult(toolCallId: string, result: {
  ok: boolean;
  data?: unknown;
  error?: { code: string; message: string; retryable: boolean };
}) {
  const normalizedResult = sanitizeToolResult(result.data);

  await db.transaction(async (tx) => {
    await tx.insert(aiToolResults).values({
      toolCallId,
      ok: result.ok,
      result: normalizedResult,
      errorCode: result.error?.code ?? null,
      errorMessage: result.error?.message?.slice(0, 2_000) ?? null,
      retryable: result.error?.retryable ?? false,
    }).onConflictDoUpdate({
      target: aiToolResults.toolCallId,
      set: {
        ok: result.ok,
        result: normalizedResult,
        errorCode: result.error?.code ?? null,
        errorMessage: result.error?.message?.slice(0, 2_000) ?? null,
        retryable: result.error?.retryable ?? false,
      },
    });
    await tx.update(aiToolCalls).set({
      status: result.ok ? "completed" : "failed",
      completedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(aiToolCalls.id, toolCallId));
  });
}

export async function listConversationMessages(userId: string, conversationId: string) {
  const [conversation] = await db.select().from(aiConversations).where(and(
    eq(aiConversations.id, conversationId),
    eq(aiConversations.userId, userId),
  )).limit(1);
  if (!conversation) throw notFound("AI conversation not found");
  const messages = await db.select({
    id: aiMessages.id,
    role: aiMessages.role,
    content: aiMessages.content,
    createdAt: aiMessages.createdAt,
  }).from(aiMessages).where(eq(aiMessages.conversationId, conversationId)).orderBy(aiMessages.createdAt);
  return { conversation, messages };
}

export async function listRecentConversations(userId: string, limit = 20) {
  return db.select({
    id: aiConversations.id,
    accountId: aiConversations.accountId,
    title: aiConversations.title,
    status: aiConversations.status,
    lastMessageAt: aiConversations.lastMessageAt,
  }).from(aiConversations).where(eq(aiConversations.userId, userId)).orderBy(desc(aiConversations.lastMessageAt)).limit(Math.min(Math.max(limit, 1), 50));
}

export async function listActiveAiScopes(userId: string, accountId?: string) {
  const now = new Date();
  const rows = await db.select({
    scope: aiPermissionGrants.scope,
    accountId: aiPermissionGrants.accountId,
    workspaceId: aiPermissionGrants.workspaceId,
    expiresAt: aiPermissionGrants.expiresAt,
  }).from(aiPermissionGrants).where(and(
    eq(aiPermissionGrants.userId, userId),
    isNull(aiPermissionGrants.revokedAt),
    accountId
      ? or(eq(aiPermissionGrants.accountId, accountId), isNull(aiPermissionGrants.accountId))
      : isNull(aiPermissionGrants.accountId),
  ));
  return rows.filter((row) => !row.expiresAt || row.expiresAt > now);
}

export async function grantAiScope(input: {
  userId: string;
  accountId?: string;
  workspaceId?: string;
  scope: string;
  source?: string;
  expiresAt?: Date;
}) {
  const [existing] = await db.select().from(aiPermissionGrants).where(and(
    eq(aiPermissionGrants.userId, input.userId),
    eq(aiPermissionGrants.scope, input.scope),
    isNull(aiPermissionGrants.revokedAt),
    input.accountId ? eq(aiPermissionGrants.accountId, input.accountId) : isNull(aiPermissionGrants.accountId),
    input.workspaceId ? eq(aiPermissionGrants.workspaceId, input.workspaceId) : isNull(aiPermissionGrants.workspaceId),
  )).limit(1);
  if (existing && (!existing.expiresAt || existing.expiresAt > new Date())) return existing;

  const [grant] = await db.insert(aiPermissionGrants).values({
    userId: input.userId,
    accountId: input.accountId ?? null,
    workspaceId: input.workspaceId ?? null,
    scope: input.scope,
    source: input.source ?? "user",
    expiresAt: input.expiresAt ?? null,
  }).returning();
  return grant;
}

export async function revokeAiScope(userId: string, grantId: string) {
  const [updated] = await db.update(aiPermissionGrants).set({
    revokedAt: new Date(),
    updatedAt: new Date(),
  }).where(and(
    eq(aiPermissionGrants.id, grantId),
    eq(aiPermissionGrants.userId, userId),
  )).returning();
  if (!updated) throw notFound("AI permission grant not found");
  return updated;
}

export async function requestAiConfirmation(input: {
  conversationId: string;
  runId?: string;
  toolCallId?: string;
  userId: string;
  action: string;
  summary: string;
  expiresAt?: Date;
  metadata?: Record<string, unknown>;
}) {
  const [confirmation] = await db.insert(aiConfirmations).values({
    conversationId: input.conversationId,
    runId: input.runId ?? null,
    toolCallId: input.toolCallId ?? null,
    userId: input.userId,
    action: input.action,
    summary: input.summary,
    status: "pending",
    expiresAt: input.expiresAt ?? null,
    metadata: input.metadata ?? null,
  }).returning();
  return confirmation;
}

export async function decideAiConfirmation(userId: string, confirmationId: string, decision: "approved" | "rejected") {
  const [updated] = await db.update(aiConfirmations).set({
    status: decision,
    decidedAt: new Date(),
    updatedAt: new Date(),
  }).where(and(
    eq(aiConfirmations.id, confirmationId),
    eq(aiConfirmations.userId, userId),
    eq(aiConfirmations.status, "pending"),
  )).returning();
  if (!updated) throw notFound("pending AI confirmation not found");
  return updated;
}
