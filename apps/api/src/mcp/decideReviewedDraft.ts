import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "../db/client.js";
import { mcpActionApprovals } from "../db/schema.js";
import { requireAccountPermission } from "../auth/authorize.js";
import { loadMcpDraftForReview } from "./draftPayloadStore.js";
import { mcpArgumentsDigest } from "./writeApprovalPolicy.js";

/**
 * First-party approval decision service. Caller must authenticate a GSW product
 * user through the normal web session; never expose this via MCP or accept
 * identity from the request body.
 *
 * Only exact reviewed, encrypted draft proposals may be decided. The initial
 * implementation supports draft creation only, not external sends.
 */
export async function decideReviewedMcpDraft(input: {
  userId: string;
  approvalId: string;
  decision: "approve" | "reject";
  reviewedArgumentsDigest: string;
}): Promise<{ status: "approved" | "rejected" } | null> {
  if (!input.userId || !/^[0-9a-f-]{36}$/i.test(input.approvalId) ||
      !/^[0-9a-f]{64}$/.test(input.reviewedArgumentsDigest)) return null;

  const review = await loadMcpDraftForReview({
    userId: input.userId, approvalId: input.approvalId,
  });
  if (!review || review.toolName !== "mail.create_draft" ||
      mcpArgumentsDigest(review.arguments) !== input.reviewedArgumentsDigest) return null;

  // Re-check live mailbox permissions at the approval moment.
  await requireAccountPermission(input.userId, review.accountId, "send");
  const now = new Date();
  const status = input.decision === "approve" ? "approved" : "rejected";
  const rows = await db.update(mcpActionApprovals)
    .set({ status, decidedAt: now })
    .where(and(
      eq(mcpActionApprovals.id, input.approvalId),
      eq(mcpActionApprovals.userId, input.userId),
      eq(mcpActionApprovals.accountId, review.accountId),
      eq(mcpActionApprovals.toolName, "mail.create_draft"),
      eq(mcpActionApprovals.argumentsDigest, input.reviewedArgumentsDigest),
      eq(mcpActionApprovals.status, "pending"),
      isNull(mcpActionApprovals.decidedAt),
      gt(mcpActionApprovals.expiresAt, now),
    )).returning({ id: mcpActionApprovals.id });
  return rows.length === 1 ? { status } : null;
}
