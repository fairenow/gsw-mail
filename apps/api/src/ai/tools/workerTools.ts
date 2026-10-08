import { z } from "zod";
import { runReadOnlyWorker } from "../workerService.js";
import { runReviewer } from "../reviewerService.js";
import type { AgentExecutionContext, AgentToolDefinition, AgentToolResult } from "./types.js";

const success = <T>(ctx: AgentExecutionContext, toolCallId: string, startedAt: string, data: T): AgentToolResult<T> => ({
  ok: true,
  toolCallId,
  data,
  audit: { userId: ctx.userId, accountId: ctx.accountId, startedAt, completedAt: new Date().toISOString() },
});

const failure = (ctx: AgentExecutionContext, toolCallId: string, startedAt: string, error: unknown): AgentToolResult => ({
  ok: false,
  toolCallId,
  error: { code: "worker_failed", message: error instanceof Error ? error.message : String(error), retryable: true },
  audit: { userId: ctx.userId, accountId: ctx.accountId, startedAt, completedAt: new Date().toISOString() },
});

const workerSchema = z.enum(["mail", "research", "calendar", "files", "campaign", "browser", "admin"]);

export const workerDelegateTool: AgentToolDefinition = {
  name: "workers.delegate",
  description: "Delegate a bounded investigation to a specialized read-only GSW worker. Use this for substantial subtasks that benefit from focused mailbox, research, file, campaign, calendar, or admin investigation. The worker cannot perform external actions or writes.",
  inputSchema: {
    type: "object",
    properties: {
      worker: { type: "string", enum: ["mail", "research", "calendar", "files", "campaign", "browser", "admin"] },
      instruction: { type: "string", description: "A self-contained subtask with the exact question to investigate." },
    },
    required: ["worker", "instruction"],
    additionalProperties: false,
  },
  requiredScopes: [],
  risk: "read",
  async execute(ctx, rawInput, toolCallId) {
    const startedAt = new Date().toISOString();
    try {
      const input = z.object({
        worker: workerSchema,
        instruction: z.string().trim().min(1).max(20_000),
      }).parse(rawInput);
      const result = await runReadOnlyWorker({
        worker: input.worker,
        instruction: input.instruction,
        context: ctx,
      });
      return success(ctx, toolCallId, startedAt, result);
    } catch (error) {
      return failure(ctx, toolCallId, startedAt, error);
    }
  },
};

export const workersParallelTool: AgentToolDefinition = {
  name: "workers.parallel",
  description: "Run up to four independent read-only specialized investigations in parallel, then return all findings to the coordinator. Use this for substantial work that can be safely split into independent research, mail, file, campaign, calendar, or admin subtasks.",
  inputSchema: {
    type: "object",
    properties: {
      tasks: {
        type: "array",
        minItems: 2,
        maxItems: 4,
        items: {
          type: "object",
          properties: {
            worker: { type: "string", enum: ["mail", "research", "calendar", "files", "campaign", "browser", "admin"] },
            instruction: { type: "string" },
          },
          required: ["worker", "instruction"],
          additionalProperties: false,
        },
      },
    },
    required: ["tasks"],
    additionalProperties: false,
  },
  requiredScopes: [],
  risk: "read",
  async execute(ctx, rawInput, toolCallId) {
    const startedAt = new Date().toISOString();
    try {
      const input = z.object({
        tasks: z.array(z.object({
          worker: workerSchema,
          instruction: z.string().trim().min(1).max(20_000),
        })).min(2).max(4),
      }).parse(rawInput);

      const results = await Promise.all(input.tasks.map((task) =>
        runReadOnlyWorker({
          worker: task.worker,
          instruction: task.instruction,
          context: ctx,
          maxTurns: 4,
        }),
      ));

      return success(ctx, toolCallId, startedAt, { results });
    } catch (error) {
      return failure(ctx, toolCallId, startedAt, error);
    }
  },
};

export const workerReviewTool: AgentToolDefinition = {
  name: "workers.review",
  description: "Ask the bounded GSW Reviewer to quality-check prepared work before it is sent, launched, scheduled, or presented for approval. The reviewer cannot take actions.",
  inputSchema: {
    type: "object",
    properties: {
      workType: { type: "string", description: "Short label such as email draft, campaign, meeting, research summary, or document." },
      content: { type: "string", description: "The prepared work to review." },
      context: { type: "string", description: "Optional relevant facts or constraints the reviewer should check against." },
    },
    required: ["workType", "content"],
    additionalProperties: false,
  },
  requiredScopes: [],
  risk: "read",
  async execute(ctx, rawInput, toolCallId) {
    const startedAt = new Date().toISOString();
    try {
      const input = z.object({
        workType: z.string().trim().min(1).max(120),
        content: z.string().trim().min(1).max(24_000),
        context: z.string().trim().max(12_000).optional(),
      }).parse(rawInput);
      const result = await runReviewer({
        userId: ctx.userId,
        workType: input.workType,
        content: input.content,
        ...(input.context !== undefined ? { context: input.context } : {}),
      });
      return success(ctx, toolCallId, startedAt, result);
    } catch (error) {
      return failure(ctx, toolCallId, startedAt, error);
    }
  },
};

export const workerTools: AgentToolDefinition[] = [workerDelegateTool, workersParallelTool, workerReviewTool];
