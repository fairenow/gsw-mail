import { randomUUID } from "node:crypto";
import { agentMailRegistry } from "../ai/tools/registry.js";
import type { AgentExecutionContext } from "../ai/tools/types.js";

/**
 * Shared capability execution boundary.
 * Authentication, account authorization and write reservations are applied
 * upstream. Both MCP and native AI can use this without transport logic.
 */
export async function executeAuthorizedCapability(input: {
  toolName: string;
  argumentsValue: unknown;
  context: AgentExecutionContext;
  toolCallId?: string;
}) {
  return agentMailRegistry.execute(
    input.toolName,
    JSON.stringify(input.argumentsValue),
    input.context,
    input.toolCallId ?? randomUUID(),
  );
}
