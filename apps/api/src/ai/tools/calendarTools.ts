import { z } from "zod";
import { getUserEngine } from "../../engine/index.js";
import type { AgentExecutionContext, AgentToolDefinition, AgentToolResult } from "./types.js";

const audit = (ctx: AgentExecutionContext, startedAt: string) => ({
  userId: ctx.userId, accountId: ctx.accountId, startedAt, completedAt: new Date().toISOString(),
});
const failed = (ctx: AgentExecutionContext, toolCallId: string, startedAt: string, error: unknown): AgentToolResult => {
  console.error("[gsw-calendar] AI calendar tool failed", { toolCallId, errorType: error instanceof Error ? error.name : "Unknown" });
  return { ok: false, toolCallId, error: { code: "calendar_unavailable", message: "Calendar information is unavailable. Please retry.", retryable: true }, audit: audit(ctx, startedAt) };
};
const calendarEngine = (ctx: AgentExecutionContext) => getUserEngine({
  productUserId: ctx.userId, authUserId: ctx.authUserId,
  accountId: ctx.accountId, headers: ctx.headers, permission: "read",
});
const success = <T>(ctx: AgentExecutionContext, toolCallId: string, startedAt: string, data: T): AgentToolResult<T> =>
  ({ ok: true, toolCallId, data, audit: audit(ctx, startedAt) });

export const calendarListTool: AgentToolDefinition = {
  name: "calendar.list",
  description: "List calendars accessible to the authenticated user in the selected mailbox. Read-only; use before creating an event.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  requiredScopes: ["calendar.read"],
  risk: "read",
  async execute(ctx, _input, toolCallId) {
    const startedAt = new Date().toISOString();
    try {
      const engine = await calendarEngine(ctx);
      const calendars = await engine.listCalendars(ctx.accountId);
      return success(ctx, toolCallId, startedAt, { calendars: calendars.slice(0, 100) });
    } catch (error) { return failed(ctx, toolCallId, startedAt, error); }
  },
};

export const calendarEventsTool: AgentToolDefinition = {
  name: "calendar.events.list",
  description: "Find scheduled events in an explicit date range for the selected mailbox, including titles, times, locations and attendees. Read-only. Do not invent unavailable meetings.",
  inputSchema: {
    type: "object",
    properties: {
      after: { type: "string", description: "ISO 8601 range start (inclusive)" },
      before: { type: "string", description: "ISO 8601 range end (exclusive)" },
      limit: { type: "integer", minimum: 1, maximum: 100 },
    },
    required: ["after", "before"], additionalProperties: false,
  },
  requiredScopes: ["calendar.read"],
  risk: "read",
  async execute(ctx, rawInput, toolCallId) {
    const startedAt = new Date().toISOString();
    try {
      const input = z.object({ after: z.string().datetime({ offset: true }), before: z.string().datetime({ offset: true }), limit: z.number().int().min(1).max(100).default(50) }).parse(rawInput);
      const after = new Date(input.after), before = new Date(input.before);
      if (before <= after || before.getTime()-after.getTime() > 93*86_400_000) {
        return { ok: false, toolCallId, error: { code: "invalid_range", message: "Choose a date range of up to 93 days.", retryable: false }, audit: audit(ctx, startedAt) };
      }
      const engine = await calendarEngine(ctx);
      const events = await engine.listCalendarEvents(ctx.accountId, after.toISOString(), before.toISOString());
      const sorted = [...events].sort((a,b) => a.start.localeCompare(b.start));
      return success(ctx, toolCallId, startedAt, { events: sorted.slice(0,input.limit), count: sorted.length, truncated: sorted.length > input.limit, timeRange: { after: after.toISOString(), before: before.toISOString() } });
    } catch (error) { return failed(ctx, toolCallId, startedAt, error); }
  },
};
export const calendarTools: AgentToolDefinition[] = [calendarListTool, calendarEventsTool];
