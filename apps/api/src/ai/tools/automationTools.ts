import { z } from "zod";
import { createAutomation, deleteAutomation, listAutomations, updateAutomation, approveAutomationSending, revokeAutomationSending } from "../automationService.js";
import type { AgentExecutionContext, AgentToolDefinition, AgentToolResult } from "./types.js";

const scheduleSchema = z.object({
  frequency: z.enum(["once", "hourly", "daily", "weekdays", "weekends", "weekly", "monthly"]),
  hour: z.number().int().min(0).max(23),
  minute: z.number().int().min(0).max(59),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  dayOfMonth: z.number().int().min(1).max(31).optional(),
  interval: z.number().int().min(1).max(365).optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const createInput = z.object({
  title: z.string().trim().min(1).max(120),
  instruction: z.string().trim().min(1).max(20_000),
  timeZone: z.string().trim().min(1).max(100),
  schedule: scheduleSchema,
  allowedScopes: z.array(z.enum(["mail.read", "mail.write", "calendar.read", "contacts.read", "templates.read", "signatures.read", "files.read", "files.write", "campaign.read", "campaign.write", "research.use", "browser.read", "tasks.read", "settings.read", "workspace.read", "domain.read", "alias.read"])).default(["mail.read"]),
});

const success = <T>(ctx: AgentExecutionContext, toolCallId: string, startedAt: string, data: T): AgentToolResult<T> => ({
  ok: true,
  toolCallId,
  data,
  audit: {
    userId: ctx.userId,
    accountId: ctx.accountId,
    startedAt,
    completedAt: new Date().toISOString(),
  },
});

const failure = (ctx: AgentExecutionContext, toolCallId: string, startedAt: string, error: unknown): AgentToolResult => ({
  ok: false,
  toolCallId,
  error: {
    code: "tool_failed",
    message: error instanceof Error ? error.message : String(error),
    retryable: false,
  },
  audit: {
    userId: ctx.userId,
    accountId: ctx.accountId,
    startedAt,
    completedAt: new Date().toISOString(),
  },
});

export const automationCreateTool: AgentToolDefinition = {
  name: "automations.create",
  description: [
    "Create a durable scheduled GSW Chat task that runs even when the browser is closed.",
    "Use it for recurring or one-time briefings such as daily inbox debriefs.",
    "Schedules support once, hourly, daily, weekdays, weekends, weekly, and monthly recurrence in an IANA timezone.",
    "Background execution supports explicitly authorized research and safe draft preparation. Scheduled email sending and campaign launch are not enabled.",
  ].join(" "),
  inputSchema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Short human-readable task name." },
      instruction: { type: "string", description: "Open-ended instruction to execute on every run." },
      timeZone: { type: "string", description: "IANA timezone such as America/Detroit. Use the runtime timezone context unless the user specifies another." },
      schedule: {
        type: "object",
        properties: {
          frequency: { type: "string", enum: ["once", "hourly", "daily", "weekdays", "weekends", "weekly", "monthly"] },
          hour: { type: "integer", minimum: 0, maximum: 23 },
          minute: { type: "integer", minimum: 0, maximum: 59 },
          daysOfWeek: { type: "array", items: { type: "integer", minimum: 0, maximum: 6 }, description: "0 Sunday through 6 Saturday." },
          dayOfMonth: { type: "integer", minimum: 1, maximum: 31 },
          interval: { type: "integer", minimum: 1, maximum: 365 },
          startDate: { type: "string", description: "Optional local YYYY-MM-DD." },
          endDate: { type: "string", description: "Optional local YYYY-MM-DD." },
        },
        required: ["frequency", "hour", "minute"],
        additionalProperties: false,
      },
      allowedScopes: {
        type: "array",
        items: { type: "string", enum: ["mail.read", "mail.write", "calendar.read", "contacts.read", "templates.read", "signatures.read", "files.read", "files.write", "campaign.read", "campaign.write", "research.use", "browser.read", "tasks.read", "settings.read", "workspace.read", "domain.read", "alias.read"] },
        description: "Scopes authorized for unattended research and non-sending draft preparation.",
      },
    },
    required: ["title", "instruction", "timeZone", "schedule"],
    additionalProperties: false,
  },
  requiredScopes: ["automations.write"],
  risk: "external",
  async execute(ctx, rawInput, toolCallId) {
    const startedAt = new Date().toISOString();
    try {
      const input = createInput.parse(rawInput);
      const automation = await createAutomation({
        userId: ctx.userId,
        accountId: ctx.accountId,
        sourceConversationId: ctx.conversationId,
        title: input.title,
        instruction: input.instruction,
        timeZone: input.timeZone,
        schedule: input.schedule,
        allowedScopes: input.allowedScopes,
      });
      return success(ctx, toolCallId, startedAt, {
        id: automation.id,
        title: automation.title,
        status: automation.status,
        nextRunAt: automation.nextRunAt.toISOString(),
        timeZone: automation.timeZone,
        schedule: automation.schedule,
      });
    } catch (error) {
      return failure(ctx, toolCallId, startedAt, error);
    }
  },
};

export const automationListTool: AgentToolDefinition = {
  name: "automations.list",
  description: "List the user's saved scheduled GSW Chat tasks, including their status, next run time, timezone, and schedule.",
  inputSchema: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  requiredScopes: ["automations.read"],
  risk: "read",
  async execute(ctx, _rawInput, toolCallId) {
    const startedAt = new Date().toISOString();
    try {
      const automations = await listAutomations(ctx.userId);
      return success(ctx, toolCallId, startedAt, {
        automations: automations.slice(0, 100).map((automation) => ({
          id: automation.id,
          title: automation.title,
          instruction: automation.instruction,
          status: automation.status,
          timeZone: automation.timeZone,
          schedule: automation.schedule,
          nextRunAt: automation.nextRunAt.toISOString(),
          lastRunAt: automation.lastRunAt?.toISOString() ?? null,
          lastError: automation.lastError,
        })),
      });
    } catch (error) {
      return failure(ctx, toolCallId, startedAt, error);
    }
  },
};

export const automationUpdateTool: AgentToolDefinition = {
  name: "automations.update",
  description: "Change, pause, resume, archive, rename, or reschedule an existing scheduled GSW Chat task. The user must clearly identify the intended task and change.",
  inputSchema: {
    type: "object",
    properties: {
      automationId: { type: "string" },
      title: { type: "string" },
      instruction: { type: "string" },
      status: { type: "string", enum: ["active", "paused", "archived"] },
      timeZone: { type: "string" },
      schedule: {
        type: "object",
        properties: {
          frequency: { type: "string", enum: ["once", "hourly", "daily", "weekdays", "weekends", "weekly", "monthly"] },
          hour: { type: "integer", minimum: 0, maximum: 23 },
          minute: { type: "integer", minimum: 0, maximum: 59 },
          daysOfWeek: { type: "array", items: { type: "integer", minimum: 0, maximum: 6 } },
          dayOfMonth: { type: "integer", minimum: 1, maximum: 31 },
          interval: { type: "integer", minimum: 1, maximum: 365 },
          startDate: { type: "string" },
          endDate: { type: "string" },
        },
        required: ["frequency", "hour", "minute"],
        additionalProperties: false,
      },
    },
    required: ["automationId"],
    additionalProperties: false,
  },
  requiredScopes: ["automations.write"],
  risk: "reversible_write",
  async execute(ctx, rawInput, toolCallId) {
    const startedAt = new Date().toISOString();
    try {
      const input = z.object({
        automationId: z.string().uuid(),
        title: z.string().trim().min(1).max(120).optional(),
        instruction: z.string().trim().min(1).max(20_000).optional(),
        status: z.enum(["active", "paused", "archived"]).optional(),
        timeZone: z.string().trim().min(1).max(100).optional(),
        schedule: scheduleSchema.optional(),
      }).parse(rawInput);
      const { automationId, ...patch } = input;
      const automation = await updateAutomation(ctx.userId, automationId, patch);
      return success(ctx, toolCallId, startedAt, {
        id: automation.id,
        title: automation.title,
        status: automation.status,
        nextRunAt: automation.nextRunAt.toISOString(),
        timeZone: automation.timeZone,
        schedule: automation.schedule,
      });
    } catch (error) {
      return failure(ctx, toolCallId, startedAt, error);
    }
  },
};

export const automationDeleteTool: AgentToolDefinition = {
  name: "automations.delete",
  description: "Permanently delete a scheduled GSW Chat task. Use only when the user explicitly asks to delete the task.",
  inputSchema: {
    type: "object",
    properties: {
      automationId: { type: "string" },
    },
    required: ["automationId"],
    additionalProperties: false,
  },
  requiredScopes: ["automations.write"],
  risk: "external",
  async execute(ctx, rawInput, toolCallId) {
    const startedAt = new Date().toISOString();
    try {
      const input = z.object({ automationId: z.string().uuid() }).parse(rawInput);
      const deleted = await deleteAutomation(ctx.userId, input.automationId);
      return success(ctx, toolCallId, startedAt, { id: deleted.id, deleted: true });
    } catch (error) {
      return failure(ctx, toolCallId, startedAt, error);
    }
  },
};

export const automationApproveSendingTool: AgentToolDefinition = {
  name: "automations.approve_sending",
  description: "Request explicit user confirmation to authorize an existing scheduled task to send only to the exact approved email addresses. This requires an interactive confirmation; never assume approval from the task instruction. No daily volume limit is imposed.",
  inputSchema: {
    type: "object",
    properties: {
      automationId: { type: "string", description: "Existing automation UUID" },
      allowedRecipients: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 100, description: "Exact email addresses allowed for unattended sends, including CC/BCC." },
    },
    required: ["automationId", "allowedRecipients"],
    additionalProperties: false,
  },
  requiredScopes: ["automations.write", "mail.send"],
  risk: "external",
  async execute(ctx, rawInput, toolCallId) {
    const startedAt = new Date().toISOString();
    try {
      const input = z.object({
        automationId: z.string().uuid(),
        allowedRecipients: z.array(z.string().email()).min(1).max(100),
      }).parse(rawInput);
      const automation = await approveAutomationSending({
        userId: ctx.userId,
        automationId: input.automationId,
        allowedRecipients: input.allowedRecipients,
      });
      return success(ctx, toolCallId, startedAt, { id: automation.id, sendPolicy: automation.sendPolicy });
    } catch (error) { return failure(ctx, toolCallId, startedAt, error); }
  },
};

export const automationRevokeSendingTool: AgentToolDefinition = {
  name: "automations.revoke_sending",
  description: "Immediately revoke unattended email sending for an existing scheduled task.",
  inputSchema: {
    type: "object",
    properties: { automationId: { type: "string" } },
    required: ["automationId"],
    additionalProperties: false,
  },
  requiredScopes: ["automations.write"],
  risk: "reversible_write",
  async execute(ctx, rawInput, toolCallId) {
    const startedAt = new Date().toISOString();
    try {
      const input = z.object({ automationId: z.string().uuid() }).parse(rawInput);
      const automation = await revokeAutomationSending(ctx.userId, input.automationId);
      return success(ctx, toolCallId, startedAt, { id: automation.id, sendPolicy: null });
    } catch (error) { return failure(ctx, toolCallId, startedAt, error); }
  },
};

export const automationTools: AgentToolDefinition[] = [
  automationCreateTool,
  automationListTool,
  automationUpdateTool,
  automationDeleteTool,
  automationApproveSendingTool,
  automationRevokeSendingTool,
];
