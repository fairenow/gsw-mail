import { createHash, timingSafeEqual } from "node:crypto";
import type { AgentRisk } from "../ai/tools/types.js";

/**
 * The MCP transport must load approval evidence from GSW persistence.
 * Never accept approval evidence from tools/call arguments or OAuth token claims.
 */
export interface PersistedMcpApproval {
  id: string;
  userId: string;
  accountId: string;
  clientId: string;
  toolName: string;
  argumentsDigest: string;
  status: "pending" | "approved" | "rejected" | "consumed" | "revoked";
  expiresAt: Date;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const object = value as Record<string, unknown>;
  const fields = Object.keys(object).filter(key => object[key] !== undefined).sort();
  return `{${fields.map(key => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(",")}}`;
}

/** Bind an approval to the exact normalized operation arguments. */
export function mcpArgumentsDigest(argumentsValue: unknown): string {
  return createHash("sha256").update(canonicalJson(argumentsValue)).digest("hex");
}

export type McpApprovalDecision =
  | { allowed: true; approvalId: string }
  | { allowed: false; reason: "approval_required" | "approval_expired" | "approval_mismatch" | "approval_not_active" };

export function verifyPersistedMcpApproval(input: {
  risk: AgentRisk;
  userId: string;
  accountId: string;
  clientId: string;
  toolName: string;
  argumentsValue: unknown;
  approval: PersistedMcpApproval | null;
  now?: Date;
}): McpApprovalDecision {
  const approval = input.approval;
  if (!approval) return { allowed: false, reason: "approval_required" };
  if (approval.status !== "approved") return { allowed: false, reason: "approval_not_active" };
  if (approval.expiresAt.getTime() <= (input.now ?? new Date()).getTime()) {
    return { allowed: false, reason: "approval_expired" };
  }
  if (
    !input.userId || !input.accountId || !input.clientId ||
    approval.userId !== input.userId ||
    approval.accountId !== input.accountId ||
    approval.clientId !== input.clientId ||
    approval.toolName !== input.toolName.replaceAll("__", ".")
  ) return { allowed: false, reason: "approval_mismatch" };
  const expected = Buffer.from(mcpArgumentsDigest(input.argumentsValue), "hex");
  if (!/^[0-9a-f]{64}$/.test(approval.argumentsDigest)) return { allowed: false, reason: "approval_mismatch" };
  const actual = Buffer.from(approval.argumentsDigest, "hex");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return { allowed: false, reason: "approval_mismatch" };
  }
  // Even reversible writes require trusted approval evidence until the product
  // establishes an explicit, separately scoped standing-write policy.
  return { allowed: true, approvalId: approval.id };
}
