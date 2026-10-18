import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "../db/client.js";
import { mcpActionApprovals } from "../db/schema.js";
import { mcpArgumentsDigest, verifyPersistedMcpApproval } from "./writeApprovalPolicy.js";
import type { AgentRisk } from "../ai/tools/types.js";

/** Server-owned approval evidence only. Call after OAuth and mailbox policy checks. */
export async function resolveMcpPersistedApproval(input: {
  approvalId: string;
  risk: AgentRisk;
  userId: string;
  accountId: string;
  clientId: string;
  toolName: string;
  argumentsValue: unknown;
}) {
  if (!input.approvalId || !/^[0-9a-f-]{36}$/i.test(input.approvalId)) {
    return { allowed: false as const, reason: "approval_required" as const };
  }
  const [record] = await db.select({
    id: mcpActionApprovals.id,
    userId: mcpActionApprovals.userId,
    accountId: mcpActionApprovals.accountId,
    clientId: mcpActionApprovals.clientId,
    toolName: mcpActionApprovals.toolName,
    argumentsDigest: mcpActionApprovals.argumentsDigest,
    status: mcpActionApprovals.status,
    expiresAt: mcpActionApprovals.expiresAt,
  }).from(mcpActionApprovals).where(and(
    eq(mcpActionApprovals.id, input.approvalId),
    eq(mcpActionApprovals.userId, input.userId),
    eq(mcpActionApprovals.clientId, input.clientId),
  )).limit(1);
  return verifyPersistedMcpApproval({ ...input, approval: record ?? null });
}

/**
 * Atomically claim one approved action. Concurrent requests cannot both claim it.
 * A consumed approval is never reset on execution failure, since an external
 * effect may have occurred even if the client did not receive a response.
 */
export async function consumeMcpPersistedApproval(input: Parameters<typeof resolveMcpPersistedApproval>[0]) {
  const checked = await resolveMcpPersistedApproval(input);
  if (!checked.allowed) return checked;
  const now = new Date();
  const consumed = await db.update(mcpActionApprovals)
    .set({ status: "consumed", consumedAt: now })
    .where(and(
      eq(mcpActionApprovals.id, checked.approvalId),
      eq(mcpActionApprovals.userId, input.userId),
      eq(mcpActionApprovals.clientId, input.clientId),
      eq(mcpActionApprovals.accountId, input.accountId),
      eq(mcpActionApprovals.toolName, input.toolName.replaceAll("__", ".")),
      eq(mcpActionApprovals.argumentsDigest, mcpArgumentsDigest(input.argumentsValue)),
      eq(mcpActionApprovals.status, "approved"),
      isNull(mcpActionApprovals.consumedAt),
      gt(mcpActionApprovals.expiresAt, now),
    ))
    .returning({ id: mcpActionApprovals.id });
  return consumed.length === 1
    ? { allowed: true as const, approvalId: checked.approvalId }
    : { allowed: false as const, reason: "approval_not_active" as const };
}
