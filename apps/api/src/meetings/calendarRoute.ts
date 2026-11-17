import { pool } from "../db/client.js";
import { randomUUID } from "node:crypto";
import { createOwnerCode, bookingOwnerCode } from "./ownerCode.js";
import { getUserEngine } from "../engine/index.js";
import { meetingStartUtc, partnerMeetingId } from "./calendarSync.js";
import { badRequest, notFound } from "../lib/errors.js";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { meetingOrganizer } from "./access.js";
import { serviceUnavailable } from "../lib/errors.js";
import { createMeetingClient, MeetingServiceError } from "./client.js";

const inputSchema = z.object({
  accountId: z.string().uuid(), externalEventId: z.string().uuid(), title: z.string().trim().min(1).max(500),
  scheduledAt: z.string().datetime({ offset: true }), timezone: z.string().min(1).max(100),
}).strict();

export function registerCalendarMeetingRoute(app: FastifyInstance) {
  app.post("/product/calendar-meetings/owner-code", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    reply.header("cache-control", "no-store");
    if (process.env.GSW_MEETINGS_ENABLED !== "true") throw serviceUnavailable("meetings_disabled");
    const input = z.object({ accountId: z.uuid(), eventId: z.string().min(1).max(500) }).strict().parse(req.body);
    const organizer = await meetingOrganizer(req.user!.id, input.accountId);
    if (!req.authUserId) throw notFound();
    const engine = await getUserEngine({ productUserId: req.user!.id, authUserId: req.authUserId, accountId: input.accountId, headers: req.headers as Record<string, string>, permission: "manage" });
    const event = await engine.getCalendarEvent(input.accountId, input.eventId);
    const meetingId = partnerMeetingId(event?.meetingLink);
    if (!event || !meetingId) throw notFound("No generated meeting is attached to this event.");
    const start = meetingStartUtc(event.start, event.timeZone ?? "Etc/UTC");
    const end = event.end ? Date.parse(meetingStartUtc(event.end, event.timeZone ?? "Etc/UTC")) : Date.parse(start) + 3600000;
    if (end <= Date.now()) throw badRequest("This event has ended. Use Host meeting if you need to reopen the room.");
    const client = createMeetingClient({ apiUrl: process.env.GSW_MEETINGS_API_URL ?? "", webOrigin: process.env.GSW_MEETINGS_WEB_ORIGIN ?? "", signingSecret: process.env.GSW_MEETINGS_SIGNING_SECRET ?? "" });
    await client.issueHost(organizer, { meetingId });
    await pool.query("UPDATE meeting_owner_codes SET nonce=$4,consumed_at=NULL,attempts=0,native_request_id=NULL,native_session=NULL,native_expires_at=NULL WHERE meeting_id=$1 AND account_id=$2 AND user_id=$3 AND (consumed_at IS NOT NULL OR attempts>=10 OR expires_at<=now())", [meetingId,input.accountId,req.user!.id,randomUUID()]);
    const result = await createOwnerCode(meetingId, input.accountId, req.user!.id, start);
    const code = await bookingOwnerCode(event.meetingLink ?? null, input.accountId, req.user!.id);
    if (!code) throw badRequest("This code was already used, expired, or locked. Select Host meeting to enter securely.");
    return { ...result, ownerCode: code };
  });
  app.post("/product/calendar-meetings/host", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req, reply) => {
    reply.header("cache-control", "no-store");
    if (process.env.GSW_MEETINGS_ENABLED !== "true") throw serviceUnavailable("meetings_disabled");
    const input = z.object({ accountId: z.string().uuid(), externalEventId: z.string().uuid().optional(), meetingId: z.string().regex(/^[a-zA-Z0-9_-]{1,200}$/) }).strict().parse(req.body);
    const organizer = await meetingOrganizer(req.user!.id, input.accountId);
    try {
      const client = createMeetingClient({ apiUrl: process.env.GSW_MEETINGS_API_URL ?? "", webOrigin: process.env.GSW_MEETINGS_WEB_ORIGIN ?? "", signingSecret: process.env.GSW_MEETINGS_SIGNING_SECRET ?? "" });
      return await client.issueHost(organizer, {
        meetingId: input.meetingId, ...(input.externalEventId ? {externalEventId: `${input.accountId}:${input.externalEventId}`} : {}),
      });
    } catch { throw serviceUnavailable("meeting_handoff_unavailable"); }
  });
  app.post("/product/calendar-meetings", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req, reply) => {
    reply.header("cache-control", "no-store");
    if (process.env.GSW_MEETINGS_ENABLED !== "true") throw serviceUnavailable("meetings_disabled");
    const input = inputSchema.parse(req.body);
    const organizer = await meetingOrganizer(req.user!.id, input.accountId);
    let client: ReturnType<typeof createMeetingClient>;
    try {
      client = createMeetingClient({ apiUrl: process.env.GSW_MEETINGS_API_URL ?? "", webOrigin: process.env.GSW_MEETINGS_WEB_ORIGIN ?? "", signingSecret: process.env.GSW_MEETINGS_SIGNING_SECRET ?? "" });
    } catch { throw serviceUnavailable("meetings_not_configured"); }
    try {
      const room = await client.createRoom(organizer, {
        externalEventId: `${input.accountId}:${input.externalEventId}`, title: input.title, scheduledAt: input.scheduledAt, timezone: input.timezone,
      });
      return { ...room, ...await createOwnerCode(room.meetingId, input.accountId, req.user!.id, input.scheduledAt) };
    } catch (error) {
      if (error instanceof MeetingServiceError) throw serviceUnavailable(error.code);
      throw error;
    }
  });
}
