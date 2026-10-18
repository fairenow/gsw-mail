import { randomUUID } from "node:crypto";
import { agentMailRegistry, type AgentToolRegistry } from "../ai/tools/registry.js";
import type { AgentExecutionContext } from "../ai/tools/types.js";

/**
 * Shared capability execution boundary.
 * Authentication, approval, account authorization and write reservations
 * remain upstream and must complete before calling this function.
 * Native callers retain their original raw JSON parsing and registry.
 */
export async function executeAuthorizedCapability(input: {
  toolName: string;
  context: AgentExecutionContext;
  toolCallId?: string;
  registry?: AgentToolRegistry;
} & ({ rawArguments: string; argumentsValue?: never } | { argumentsValue: unknown; rawArguments?: never })) {
  const serialized = "rawArguments" in input
    ? input.rawArguments ?? ""
    : JSON.stringify(input.argumentsValue);
  return (input.registry ?? agentMailRegistry).execute(
    input.toolName,
    serialized,
    input.context,
    input.toolCallId ?? randomUUID(),
  );
}
