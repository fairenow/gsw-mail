import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import { calendarRsvps } from "../../db/schema.js";
import { calculateFreeSlots, computeCalendarConflicts } from "./calendarAvailability.js";
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

const eventInput = z.object({
  calendarId: z.string().min(1).max(250),
  title: z.string().trim().min(1).max(500),
  description: z.string().max(20_000).optional(),
  start: z.string().datetime({ offset: true }),
  durationMinutes: z.number().int().min(1).max(10_080),
  location: z.string().max(1000).optional(),
  meetingLink: z.string().url().max(2000).optional(),
  attendees: z.array(z.string().email()).max(50).default([]),
  sendSchedulingMessages: z.boolean().default(false),
  timeZone: z.string().max(100).optional(),
  allDay: z.boolean().default(false),
});

const writableEngine = (ctx: AgentExecutionContext) => getUserEngine({
  productUserId: ctx.userId, authUserId: ctx.authUserId,
  accountId: ctx.accountId, headers: ctx.headers, permission: "send",
});

const calendarWriteSchema: Record<string, unknown> = {
  type: "object",
  properties: {
    calendarId: { type: "string", description: "Calendar ID from calendar.list" },
    title: { type: "string" },
    description: { type: "string" },
    start: { type: "string", description: "ISO 8601 time with timezone offset" },
    durationMinutes: { type: "integer", minimum: 1, maximum: 10080 },
    location: { type: "string" },
    meetingLink: { type: "string" },
    attendees: { type: "array", items: { type: "string" }, maxItems: 50 },
    sendSchedulingMessages: { type: "boolean", description: "Whether to notify attendees; explicit approval is required" },
    timeZone: { type: "string" },
    allDay: { type: "boolean" },
  },
  required: ["calendarId","title","start","durationMinutes"],
  additionalProperties: false,
};

export const calendarEventCreateTool: AgentToolDefinition = {
  name: "calendar.events.create",
  description: "Create a calendar event, with optional attendee invitations. Requires user confirmation before execution. Review title, start, timezone, attendees and invitation sending first.",
  inputSchema: calendarWriteSchema,
  requiredScopes: ["calendar.write"],
  risk: "external",
  async execute(ctx, rawInput, toolCallId) {
    const startedAt = new Date().toISOString();
    try {
      const input = eventInput.parse(rawInput);
      const engine = await writableEngine(ctx);
      const calendars = await engine.listCalendars(ctx.accountId);
      if (!calendars.some(calendar => calendar.engineId === input.calendarId)) throw new Error("Calendar not found");
      const conflictEnd = new Date(Date.parse(input.start) + input.durationMinutes * 60_000).toISOString();
      const existing = await engine.listCalendarEvents(ctx.accountId, new Date(Date.parse(input.start) - 7 * 86_400_000).toISOString(), conflictEnd);
      const conflicts = computeCalendarConflicts(existing, input.start, conflictEnd);
      if (conflicts.length) return { ok:false, toolCallId, error:{code:"calendar_conflict",message:"This time overlaps an existing event. Review the schedule before creating it.",retryable:false},audit:audit(ctx,startedAt) };
      const event = await engine.createCalendarEvent(ctx.accountId, input);
      return success(ctx, toolCallId, startedAt, { event, invitedAttendees: input.sendSchedulingMessages, requiresReview: false });
    } catch (error) { return failed(ctx, toolCallId, startedAt, error); }
  },
};

export const calendarEventUpdateTool: AgentToolDefinition = {
  name: "calendar.events.update",
  description: "Replace an existing calendar event with specified complete fields. Read the event first, then confirm all attendee and scheduling changes. Requires user confirmation.",
  inputSchema: {
    ...calendarWriteSchema,
    properties: { ...calendarWriteSchema.properties as Record<string, unknown>, eventId: { type: "string", description: "Existing engine event ID" } },
    required: ["eventId","calendarId","title","start","durationMinutes"],
  },
  requiredScopes: ["calendar.write"],
  risk: "external",
  async execute(ctx, rawInput, toolCallId) {
    const startedAt = new Date().toISOString();
    try {
      const input = eventInput.extend({ eventId: z.string().min(1).max(500) }).parse(rawInput);
      const { eventId, ...patch } = input;
      const engine = await writableEngine(ctx);
      const conflictEnd = new Date(Date.parse(patch.start) + patch.durationMinutes * 60_000).toISOString();
      const existing = await engine.listCalendarEvents(ctx.accountId, new Date(Date.parse(patch.start) - 7 * 86_400_000).toISOString(), conflictEnd);
      const conflicts = computeCalendarConflicts(existing, patch.start, conflictEnd, eventId);
      if (conflicts.length) return { ok:false, toolCallId, error:{code:"calendar_conflict",message:"This time overlaps an existing event. Review the schedule before changing it.",retryable:false},audit:audit(ctx,startedAt) };
      const event = await engine.updateCalendarEvent(ctx.accountId, eventId, patch);
      return success(ctx, toolCallId, startedAt, { event });
    } catch (error) { return failed(ctx, toolCallId, startedAt, error); }
  },
};

export const calendarEventDeleteTool: AgentToolDefinition = {
  name: "calendar.events.delete",
  description: "Delete an existing event. Requires explicit user approval and must not run for ambiguous events.",
  inputSchema: { type: "object", properties: { eventId: { type: "string", description: "Existing engine event ID" } }, required: ["eventId"], additionalProperties: false },
  requiredScopes: ["calendar.write"],
  risk: "external",
  async execute(ctx, rawInput, toolCallId) {
    const startedAt = new Date().toISOString();
    try {
      const { eventId } = z.object({ eventId: z.string().min(1).max(500) }).parse(rawInput);
      const engine = await writableEngine(ctx);
      await engine.destroyCalendarEvent(ctx.accountId, eventId);
      return success(ctx, toolCallId, startedAt, { deleted: true, eventId });
    } catch (error) { return failed(ctx, toolCallId, startedAt, error); }
  },
};


const availabilitySchema = z.object({
  after: z.string().datetime({ offset: true }),
  before: z.string().datetime({ offset: true }),
  durationMinutes: z.number().int().min(5).max(480).default(30),
  excludeEventId: z.string().max(500).optional(),
});
const availabilityProperties = {
  after: { type: "string", description: "UTC or offset ISO8601 start" },
  before: { type: "string", description: "UTC or offset ISO8601 end" },
  durationMinutes: { type: "integer", minimum: 5, maximum: 480 },
  excludeEventId: { type: "string" },
};
export const calendarAvailabilityTool: AgentToolDefinition = {
  name: "calendar.availability",
  description: "Read-only estimated free windows and overlapping events on the selected user's calendars. All-day or events lacking end time may not be represented as busy; do not claim confirmed availability of external attendees.",
  inputSchema: { type: "object", properties: availabilityProperties, required: ["after","before"], additionalProperties: false },
  requiredScopes: ["calendar.read"], risk: "read",
  async execute(ctx, rawInput, toolCallId) {
    const startedAt = new Date().toISOString();
    try {
      const input = availabilitySchema.parse(rawInput);
      const after = new Date(input.after), before = new Date(input.before);
      if (before <= after || before.getTime()-after.getTime()>31*86400000) throw new Error("Range exceeds 31 days");
      const engine = await calendarEngine(ctx);
      const events = await engine.listCalendarEvents(ctx.accountId, after.toISOString(), before.toISOString());
      const free = calculateFreeSlots(events, after.toISOString(), before.toISOString(), input.durationMinutes);
      const conflicts = computeCalendarConflicts(events, after.toISOString(), before.toISOString(), input.excludeEventId);
      const unknownDurationCount = events.filter(event => !event.end || !Number.isFinite(Date.parse(event.end))).length;
      return success(ctx, toolCallId, startedAt, { free: free.slice(0,50), conflicts: conflicts.slice(0,50), conflictCount: conflicts.length, unknownDurationCount, externalAttendeeAvailabilityChecked: false, estimated: true });
    } catch (error) { return failed(ctx, toolCallId, startedAt, error); }
  },
};
export const calendarRsvpStatusTool: AgentToolDefinition = {
  name: "calendar.rsvp.status",
  description: "Check RSVP responses for a calendar event belonging to the selected authorized mailbox, without exposing RSVP tokens.",
  inputSchema: { type: "object", properties: { eventId: { type: "string" } }, required: ["eventId"], additionalProperties: false },
  requiredScopes: ["calendar.read"], risk: "read",
  async execute(ctx, rawInput, toolCallId) {
    const startedAt = new Date().toISOString();
    try {
      const { eventId } = z.object({ eventId: z.string().min(1).max(1000) }).parse(rawInput);
      const engine = await calendarEngine(ctx);
      const events = await engine.listCalendarEvents(ctx.accountId, new Date(Date.now()-365*86400000).toISOString(), new Date(Date.now()+730*86400000).toISOString());
      if (!events.some(event => event.engineId === eventId)) throw new Error("Event not accessible");
      const rows = await db.select({ attendeeEmail: calendarRsvps.attendeeEmail, response: calendarRsvps.response, respondedAt: calendarRsvps.respondedAt }).from(calendarRsvps).where(and(eq(calendarRsvps.accountId, ctx.accountId), eq(calendarRsvps.eventId, eventId)));
      return success(ctx, toolCallId, startedAt, { eventId, responses: rows, counts: { accepted: rows.filter(x=>x.response==="accepted").length, declined: rows.filter(x=>x.response==="declined").length, tentative: rows.filter(x=>x.response==="tentative").length, pending: rows.filter(x=>!x.response).length } });
    } catch(error) { return failed(ctx, toolCallId, startedAt, error); }
  },
};

export const calendarTools: AgentToolDefinition[] = [calendarListTool, calendarEventsTool, calendarAvailabilityTool, calendarRsvpStatusTool, calendarEventCreateTool, calendarEventUpdateTool, calendarEventDeleteTool];
