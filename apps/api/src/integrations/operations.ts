import { randomUUID } from "node:crypto";
import { z } from "zod";
import { agentMailRegistry } from "../ai/tools/registry.js";
import { withToolBoundary } from "../ai/toolBoundary.js";
import { adminScopes } from "../mcp/accessProfile.js";
import { reserveAiIdempotency, completeAiIdempotency } from "../ai/agentState.js";
import { integrationService } from "./service.js";
import type { IntegrationPrincipal } from "./service.js";
import { hashKey, IntegrationError } from "./contract.js";

export const operationSchema = z.object({ name: z.string().min(1).max(200), arguments: z.record(z.string(), z.unknown()).default({}) }).strict();
export const mailboxOperationAllowed = (tool: { name: string; requiredScopes: readonly string[] }) => !tool.requiredScopes.some(scope => adminScopes.has(scope)) && !/^(admin|domain|workspace|alias|mailbox_admin)\./.test(tool.name);
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value !== null && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)])) : value;
const containsAdminWorker = (value: unknown): boolean => Array.isArray(value) ? value.some(containsAdminWorker) : value !== null && typeof value === "object" ? Object.entries(value).some(([k, v]) => (k === "worker" && v === "admin") || containsAdminWorker(v)) : false;

const defaultDependencies = { registry: agentMailRegistry, service: integrationService, reserve: reserveAiIdempotency, complete: completeAiIdempotency };
export function createMailboxOperations(overrides: Partial<typeof defaultDependencies> = {}) {
  const dependencies = { ...defaultDependencies, ...overrides };
  function capabilities() {
    return withToolBoundary(mailboxOperationAllowed, () => dependencies.registry.definitions().filter(mailboxOperationAllowed).map(tool => ({ name: tool.name, description: tool.description, inputSchema: JSON.parse(JSON.stringify(tool.inputSchema, (key, value) => key === "enum" && Array.isArray(value) ? value.filter(item => item !== "admin") : value)), mutates: tool.risk !== "read" })));
  }
  async function execute(principal: IntegrationPrincipal, input: z.infer<typeof operationSchema>, requestKey?: string) {
    await dependencies.service.validateKey(principal, "mailbox.full");
    const row = await dependencies.service.installation(principal.installationId);
    const name = input.name.replaceAll("__", ".");
    const tool = dependencies.registry.definition(name);
    if (!tool || !mailboxOperationAllowed(tool)) throw new IntegrationError(403, "operation_not_allowed");
    if (Object.keys(input.arguments).some(key => ["accountId", "userId", "authUserId", "organizationId", "workspaceId", "headers", "accessToken"].includes(key)) || containsAdminWorker(input.arguments)) throw new IntegrationError(403, "context_override_not_allowed");
    if (row.installation.testMode) return { simulated: true, name, accountId: row.account.id };
    const ctx = await dependencies.service.context(principal);
    const id = randomUUID();
    const digest = hashKey(JSON.stringify(canonical(input)));
    const ledgerKey = `api:${principal.installationId}:${hashKey(requestKey ?? id)}`;
    if (tool.risk !== "read") {
      if (!requestKey) throw new IntegrationError(400, "idempotency_key_required");
      const reservation = await dependencies.reserve({ key: ledgerKey, userId: ctx.userId, accountId: ctx.accountId, toolCallId: null, toolName: name, fingerprint: digest });
      if (reservation.reused) {
        if (reservation.reservation.result?.fingerprint !== digest) throw new IntegrationError(409, "idempotency_conflict");
        return { name, replayed: true, status: reservation.reservation.status === "reserved" ? "in_progress_or_unknown" : reservation.reservation.result?.ok === false ? "failed" : "completed", ok: reservation.reservation.result?.ok ?? null, operationId: ledgerKey, reference: reservation.reservation.result?.reference ?? null };
      }
    }
    await dependencies.service.validateKey(principal, "mailbox.full");
    await dependencies.service.installation(principal.installationId);
    return withToolBoundary(mailboxOperationAllowed, async () => {
      const result = await dependencies.registry.execute(name, JSON.stringify(input.arguments), { ...ctx, scheduledIdempotencyKey: ledgerKey }, id);
      if (tool.risk !== "read") {
        const data = result.data && typeof result.data === "object" ? result.data as Record<string, unknown> : {};
        const reference = Object.fromEntries(Object.entries(data).filter(([key, value]) => /^(id|.*Id|key|status|url)$/.test(key) && ["string", "number", "boolean"].includes(typeof value)));
        await dependencies.complete(ledgerKey, { fingerprint: digest, reference, ok: result.ok, errorCode: result.error?.code ?? null });
      }
      return result;
    });
  }
  return { capabilities, execute };
}
export const mailboxOperations = createMailboxOperations();
