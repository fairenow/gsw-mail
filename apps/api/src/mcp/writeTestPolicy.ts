import { createHash } from "node:crypto";
import type { AgentRisk } from "../ai/tools/types.js";
import { mcpArgumentsDigest } from "./writeApprovalPolicy.js";

/**
 * Explicit, owner-scoped development mode. Never allow a blanket MCP write
 * switch or infer ownership from request parameters.
 */
export function canUseMcpWriteTestMode(input: {
  userId: string;
  enabled?: string;
  allowedUserId?: string;
}): boolean {
  return input.enabled === "true" &&
    typeof input.allowedUserId === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.allowedUserId) &&
    input.userId === input.allowedUserId;
}

export function mcpWriteCallPolicy(input: {
  risk: AgentRisk;
  requestId: unknown;
  confirmExternal: unknown;
  userId: string;
  clientId: string;
  accountId: string;
  toolName: string;
  argumentsValue: unknown;
}):
  | { allowed: true; key: string; digest: string }
  | { allowed: false; reason: string } {
  if (input.risk === "read") return { allowed: false, reason: "not_a_write_action" };
  if (typeof input.requestId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.requestId)) {
    return { allowed: false, reason: "request_id_uuid_required" };
  }
  if (input.risk === "external" && input.confirmExternal !== true) {
    return { allowed: false, reason: "explicit_external_confirmation_required" };
  }
  const key = "mcp:" + createHash("sha256")
    .update(JSON.stringify([input.userId, input.clientId, input.requestId])).digest("hex");
  const digest = mcpArgumentsDigest({
    accountId: input.accountId, toolName: input.toolName.replaceAll("__", "."),
    arguments: input.argumentsValue,
  });
  return { allowed: true, key, digest };
}
