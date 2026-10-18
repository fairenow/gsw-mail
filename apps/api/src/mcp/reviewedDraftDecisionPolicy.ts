import { mcpArgumentsDigest } from "./writeApprovalPolicy.js";

export function isReviewedDraftDecisionValid(
  review: { toolName: string; status: string; expiresAt: Date; arguments: unknown } | null,
  digest: string,
  now: Date = new Date(),
): boolean {
  return review !== null &&
    review.toolName === "mail.create_draft" &&
    review.status === "pending" &&
    review.expiresAt.getTime() > now.getTime() &&
    /^[0-9a-f]{64}$/.test(digest) &&
    mcpArgumentsDigest(review.arguments) === digest;
}
