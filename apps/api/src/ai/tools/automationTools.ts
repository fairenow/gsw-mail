import { z } from "zod";
import { createAutomation } from "../automationService.js";
import type { AgentExecutionContext, AgentToolDefinition, AgentToolResult } from "./types.js";

const scheduleSchema = z.object({
  frequency: z.enum(["once", "daily", "weekdays", "weekends", "weekly", "monthly"]),
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
  allowedScopes: z.array(z.enum(["mail.read"])).default(["mail.read"]),
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
    "Schedules support once, daily, weekdays, weekends, weekly, and monthly recurrence in an IANA timezone.",
    "Background execution currently supports read-only mailbox briefing context. Do not promise automatic email sending or campaign launch from a scheduled task yet.",
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
          frequency: { type: "string", enum: ["once", "daily", "weekdays", "weekends", "weekly", "monthly"] },
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
        items: { type: "string", enum: ["mail.read"] },
        description: "Background capabilities currently limited to mail.read.",
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

export const automationTools: AgentToolDefinition[] = [automationCreateTool];
