import { and, eq, gt } from "drizzle-orm";
import { db } from "../db/client.js";
import { mcpActionApprovals } from "../db/schema.js";
import { mcpArgumentsDigest, verifyPersistedMcpApproval } from "./writeApprovalPolicy.js";

/**
 * Server-side ledger for MCP action approvals.
 * This deliberately stores only an arguments digest, not email/file contents.
 * No MCP write tool execution is enabled until an approved operation's
 * original arguments can be retrieved from a separately protected payload store.
 */
export async function createMcpApprovalRequest(input: {
  userId: string;
  accountId: string;
  clientId: string;
  toolName: string;
  argumentsValue: unknown;
  summary: string;
  expiresAt: Date;
}) {
  if (!input.userId || !input.accountId || !input.clientId || !input.toolName || !input.summary) {
    throw new Error("Missing approval request identity or summary");
  }
  if (input.clientId.length > 256 || input.toolName.length > 256 || input.summary.length > 1000) {
    throw new Error("Approval request exceeds limits");
  }
  const now = new Date();
  if (!(input.expiresAt instanceof Date) || !Number.isFinite(input.expiresAt.getTime()) ||
    input.expiresAt.getTime() <= now.getTime() || input.expiresAt.getTime() > now.getTime() + 30 * 60_000) {
    throw new Error("Approval expiration must be within 30 minutes");
  }
  const [created] = await db.insert(mcpActionApprovals).values({
    userId: input.userId,
    accountId: input.accountId,
    clientId: input.clientId,
    toolName: input.toolName.replaceAll("__", "."),
    argumentsDigest: mcpArgumentsDigest(input.argumentsValue),
    summary: input.summary,
    status: "pending",
    expiresAt: input.expiresAt,
  }).returning({
    id: mcpActionApprovals.id,
    status: mcpActionApprovals.status,
    summary: mcpActionApprovals.summary,
    expiresAt: mcpActionApprovals.expiresAt,
  });
  if (!created) throw new Error("Approval request could not be created");
  return created;
}

/** Only an authenticated GSW user-facing approval handler may call this. */
export async function decideMcpApproval(input: {
  userId: string;
  approvalId: string;
  decision: "approved" | "rejected";
}) {
  const [updated] = await db.update(mcpActionApprovals).set({
    status: input.decision,
    decidedAt: new Date(),
    updatedAt: new Date(),
  }).where(and(
    eq(mcpActionApprovals.id, input.approvalId),
    eq(mcpActionApprovals.userId, input.userId),
    eq(mcpActionApprovals.status, "pending"),
    gt(mcpActionApprovals.expiresAt, new Date()),
  )).returning({
    id: mcpActionApprovals.id,
    status: mcpActionApprovals.status,
    toolName: mcpActionApprovals.toolName,
    summary: mcpActionApprovals.summary,
  });
  return updated ?? null;
}

/** Atomic claim: only one concurrent caller can consume an approved action. */
export async function claimApprovedMcpAction(input: {
  approvalId: string;
  userId: string;
  accountId: string;
  clientId: string;
  toolName: string;
  argumentsValue: unknown;
}) {
  const [candidate] = await db.select().from(mcpActionApprovals).where(and(
    eq(mcpActionApprovals.id, input.approvalId),
    eq(mcpActionApprovals.userId, input.userId),
    eq(mcpActionApprovals.accountId, input.accountId),
    eq(mcpActionApprovals.clientId, input.clientId),
  )).limit(1);
  const verification = verifyPersistedMcpApproval({
    risk: "external",
    userId: input.userId,
    accountId: input.accountId,
    clientId: input.clientId,
    toolName: input.toolName,
    argumentsValue: input.argumentsValue,
    approval: candidate ?? null,
  });
  if (!verification.allowed) return { allowed: false as const, reason: verification.reason };
  const [claimed] = await db.update(mcpActionApprovals).set({
    status: "consumed",
    consumedAt: new Date(),
    updatedAt: new Date(),
  }).where(and(
    eq(mcpActionApprovals.id, input.approvalId),
    eq(mcpActionApprovals.userId, input.userId),
    eq(mcpActionApprovals.accountId, input.accountId),
    eq(mcpActionApprovals.clientId, input.clientId),
    eq(mcpActionApprovals.toolName, input.toolName.replaceAll("__", ".")),
    eq(mcpActionApprovals.argumentsDigest, mcpArgumentsDigest(input.argumentsValue)),
    eq(mcpActionApprovals.status, "approved"),
    gt(mcpActionApprovals.expiresAt, new Date()),
  )).returning({ id: mcpActionApprovals.id });
  return claimed
    ? { allowed: true as const, approvalId: claimed.id }
    : { allowed: false as const, reason: "approval_not_active" as const };
}

/** Owner-scoped review listing; no raw tool arguments or message bodies. */
export async function listMcpApprovals(userId: string, limit = 30) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error("Invalid limit");
  return db.select({
    id: mcpActionApprovals.id,
    accountId: mcpActionApprovals.accountId,
    clientId: mcpActionApprovals.clientId,
    toolName: mcpActionApprovals.toolName,
    summary: mcpActionApprovals.summary,
    status: mcpActionApprovals.status,
    expiresAt: mcpActionApprovals.expiresAt,
    createdAt: mcpActionApprovals.createdAt,
  }).from(mcpActionApprovals)
    .where(eq(mcpActionApprovals.userId, userId))
    .orderBy(mcpActionApprovals.createdAt)
    .limit(limit);
}
