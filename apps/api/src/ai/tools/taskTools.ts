import { z } from "zod";
import { createAgentTask, getAgentTask, listAgentTasks, updateAgentTask, updateAgentTaskStep } from "../taskService.js";
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
  error: { code: "tool_failed", message: error instanceof Error ? error.message : String(error), retryable: false },
  audit: { userId: ctx.userId, accountId: ctx.accountId, startedAt, completedAt: new Date().toISOString() },
});

const worker = z.enum(["coordinator", "mail", "research", "calendar", "files", "campaign", "admin"]);

const createInput = z.object({
  title: z.string().trim().min(1).max(160),
  instruction: z.string().trim().min(1).max(30_000),
  worker: worker.optional(),
  selectedSkills: z.array(z.string().trim().min(1).max(100)).max(12).optional(),
  steps: z.array(z.object({
    title: z.string().trim().min(1).max(300),
    worker: worker.optional(),
  })).max(50).optional(),
});

export const tasksCreateTool: AgentToolDefinition = {
  name: "tasks.create",
  description: "Create a durable multi-step GSW work task when the user's request is substantial, may span multiple agent actions, may continue after the chat closes, or benefits from visible progress. Do not create tasks for simple one-step requests.",
  inputSchema: {
    type: "object",
    properties: {
      title: { type: "string" },
      instruction: { type: "string" },
      worker: { type: "string", enum: ["coordinator", "mail", "research", "calendar", "files", "campaign", "admin"] },
      selectedSkills: { type: "array", items: { type: "string" }, maxItems: 12 },
      steps: {
        type: "array",
        maxItems: 50,
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            worker: { type: "string", enum: ["coordinator", "mail", "research", "calendar", "files", "campaign", "admin"] },
          },
          required: ["title"],
          additionalProperties: false,
        },
      },
    },
    required: ["title", "instruction"],
    additionalProperties: false,
  },
  requiredScopes: ["tasks.write"],
  risk: "reversible_write",
  async execute(ctx, rawInput, toolCallId) {
    const startedAt = new Date().toISOString();
    try {
      const input = createInput.parse(rawInput);
      const task = await createAgentTask({
        userId: ctx.userId,
        accountId: ctx.accountId,
        conversationId: ctx.conversationId,
        title: input.title,
        instruction: input.instruction,
        ...(input.worker !== undefined ? { worker: input.worker } : {}),
        ...(input.selectedSkills !== undefined ? { selectedSkills: input.selectedSkills } : {}),
        ...(input.steps !== undefined ? { steps: input.steps } : {}),
      });
      return success(ctx, toolCallId, startedAt, { taskId: task.id, title: task.title, status: task.status });
    } catch (error) {
      return failure(ctx, toolCallId, startedAt, error);
    }
  },
};

export const tasksListTool: AgentToolDefinition = {
  name: "tasks.list",
  description: "List the user's recent durable GSW agent tasks and their current status.",
  inputSchema: { type: "object", properties: { limit: { type: "number", minimum: 1, maximum: 100 } }, additionalProperties: false },
  requiredScopes: ["tasks.read"],
  risk: "read",
  async execute(ctx, rawInput, toolCallId) {
    const startedAt = new Date().toISOString();
    try {
      const input = z.object({ limit: z.number().int().min(1).max(100).optional() }).parse(rawInput);
      const tasks = await listAgentTasks(ctx.userId, input.limit ?? 30);
      return success(ctx, toolCallId, startedAt, { tasks });
    } catch (error) {
      return failure(ctx, toolCallId, startedAt, error);
    }
  },
};

export const tasksReadTool: AgentToolDefinition = {
  name: "tasks.read",
  description: "Read one durable GSW agent task including its step plan and progress.",
  inputSchema: { type: "object", properties: { taskId: { type: "string" } }, required: ["taskId"], additionalProperties: false },
  requiredScopes: ["tasks.read"],
  risk: "read",
  async execute(ctx, rawInput, toolCallId) {
    const startedAt = new Date().toISOString();
    try {
      const input = z.object({ taskId: z.string().uuid() }).parse(rawInput);
      return success(ctx, toolCallId, startedAt, await getAgentTask(ctx.userId, input.taskId));
    } catch (error) {
      return failure(ctx, toolCallId, startedAt, error);
    }
  },
};

export const tasksUpdateTool: AgentToolDefinition = {
  name: "tasks.update",
  description: "Update progress or state for a durable GSW agent task or one of its steps. Use waiting when the task needs user input or approval.",
  inputSchema: {
    type: "object",
    properties: {
      taskId: { type: "string" },
      status: { type: "string", enum: ["planned", "running", "waiting", "completed", "failed", "cancelled"] },
      currentStep: { type: "number", minimum: 0 },
      progressPercent: { type: "number", minimum: 0, maximum: 100 },
      stepSequence: { type: "number", minimum: 0 },
      stepStatus: { type: "string", enum: ["pending", "running", "waiting", "completed", "failed", "skipped"] },
    },
    required: ["taskId"],
    additionalProperties: false,
  },
  requiredScopes: ["tasks.write"],
  risk: "reversible_write",
  async execute(ctx, rawInput, toolCallId) {
    const startedAt = new Date().toISOString();
    try {
      const input = z.object({
        taskId: z.string().uuid(),
        status: z.enum(["planned", "running", "waiting", "completed", "failed", "cancelled"]).optional(),
        currentStep: z.number().int().min(0).optional(),
        progressPercent: z.number().int().min(0).max(100).optional(),
        stepSequence: z.number().int().min(0).optional(),
        stepStatus: z.enum(["pending", "running", "waiting", "completed", "failed", "skipped"]).optional(),
      }).parse(rawInput);
      const task = await updateAgentTask(ctx.userId, input.taskId, {
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.currentStep !== undefined ? { currentStep: input.currentStep } : {}),
        ...(input.progressPercent !== undefined ? { progressPercent: input.progressPercent } : {}),
      });
      const step = input.stepSequence !== undefined && input.stepStatus
        ? await updateAgentTaskStep(ctx.userId, input.taskId, input.stepSequence, { status: input.stepStatus })
        : null;
      return success(ctx, toolCallId, startedAt, { task, step });
    } catch (error) {
      return failure(ctx, toolCallId, startedAt, error);
    }
  },
};

export const taskTools: AgentToolDefinition[] = [tasksCreateTool, tasksListTool, tasksReadTool, tasksUpdateTool];
