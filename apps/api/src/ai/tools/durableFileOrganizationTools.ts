import { z } from "zod";
import { startOrganizationJob, getOrganizationJob, changeOrganizationJob } from "../../files/organizationJobs.js";
import type { AgentToolDefinition, AgentExecutionContext, AgentToolResult } from "./types.js";

const uuid = z.string().uuid();
const hash = z.string().regex(/^[0-9a-f]{64}$/);
function makeTool(name: string, description: string, risk: "read" | "reversible_write",
  properties: Record<string, unknown>, required: string[], schema: z.ZodTypeAny,
  action: (ctx: AgentExecutionContext, input: any) => Promise<unknown>): AgentToolDefinition {
  return {
    name, description, risk, requiredScopes: [risk === "read" ? "files.read" : "files.write"],
    inputSchema: { type: "object", properties, required, additionalProperties: false },
    async execute(ctx, raw, toolCallId) {
      const startedAt = new Date().toISOString();
      try {
        const data = await action(ctx, schema.parse(raw));
        return { ok: true, toolCallId, data, audit: { userId: ctx.userId, accountId: ctx.accountId, startedAt, completedAt: new Date().toISOString() } };
      } catch (error) {
        return { ok: false, toolCallId, error: { code: "file_organization_error", message: error instanceof Error ? error.message : String(error), retryable: false },
          audit: { userId: ctx.userId, accountId: ctx.accountId, startedAt, completedAt: new Date().toISOString() } };
      }
    },
  };
}
export const durableFileOrganizationTools: AgentToolDefinition[] = [
  makeTool("files.organize_start", "After the user has approved a files.organize_preview result, enqueue the entire approved plan as a durable background organization job. This is the only tool needed to organize all files; do not call files.organize_apply repeatedly.",
    "reversible_write",
    { planHash: { type: "string" }, dateBasis: { type: "string", enum: ["created", "uploaded"] } },
    ["planHash"], z.object({ planHash: hash, dateBasis: z.enum(["created", "uploaded"]).default("created") }),
    (ctx, input) => startOrganizationJob(ctx.userId, input.planHash, input.dateBasis)),
  makeTool("files.organize_status", "Check progress, counts and failures of a durable file organization job.",
    "read", { jobId: { type: "string" } }, ["jobId"], z.object({ jobId: uuid }),
    (ctx, input) => getOrganizationJob(ctx.userId, input.jobId)),
  makeTool("files.organize_control", "Pause or resume a durable file organization job. Pausing is cooperative and may finish one in-flight file first.",
    "reversible_write", { jobId: { type: "string" }, command: { type: "string", enum: ["pause", "resume"] } },
    ["jobId", "command"], z.object({ jobId: uuid, command: z.enum(["pause", "resume"]) }),
    (ctx, input) => changeOrganizationJob(ctx.userId, input.jobId, input.command)),
];
