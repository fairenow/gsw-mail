import { and, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { mcpActionApprovals } from "../db/schema.js";
import { verifyPersistedMcpApproval } from "./writeApprovalPolicy.js";
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
