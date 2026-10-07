import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAccountPermission } from "../auth/authorize.js";
import { requireUser } from "../auth/middleware.js";
import { db } from "../db/client.js";
import { calendarRsvps } from "../db/schema.js";
import { calendarRsvpUrl, createCalendarRsvpToken } from "../lib/calendarRsvp.js";

const issueSchema = z.object({
  accountId: z.string().uuid(),
  event: z.object({
    engineId: z.string().min(1).max(1_000),
    title: z.string().min(1).max(500),
    start: z.string().min(1),
    end: z.string().optional(),
    location: z.string().max(1_000).optional(),
    meetingLink: z.string().url().max(2_000).optional(),
    attendees: z.array(z.string().email()).min(1).max(50),
  }),
});

const listSchema = z.object({ accountId: z.string().uuid(), eventId: z.string().min(1) });

const expiryFor = (start: Date): Date => {
  const nowFloor = new Date(Date.now() + 30 * 24 * 60 * 60 * 1_000);
  const afterEvent = new Date(start.getTime() + 30 * 24 * 60 * 60 * 1_000);
  return afterEvent > nowFloor ? afterEvent : nowFloor;
};

export default async function calendarRsvpRoutes(app: FastifyInstance) {
  await requireUser(app, { optional: false });

  app.post("/product/calendar-rsvps/links", async (req) => {
    const input = issueSchema.parse(req.body);
    await requireAccountPermission(req.user!.id, input.accountId, "send");
    const start = new Date(input.event.start);
    if (Number.isNaN(start.getTime())) throw new Error("invalid event start");
    const end = input.event.end ? new Date(input.event.end) : null;
    const expiresAt = expiryFor(start);
    const attendees = [...new Set(input.event.attendees.map((email) => email.trim().toLowerCase()))];
    const links = [];

    for (const attendeeEmail of attendees) {
      const [row] = await db.insert(calendarRsvps).values({
        accountId: input.accountId,
        eventId: input.event.engineId,
        attendeeEmail,
        eventTitle: input.event.title,
        eventStart: start,
        eventEnd: end && !Number.isNaN(end.getTime()) ? end : null,
        eventLocation: input.event.location ?? null,
        meetingLink: input.event.meetingLink ?? null,
        expiresAt,
      }).onConflictDoUpdate({
        target: [calendarRsvps.accountId, calendarRsvps.eventId, calendarRsvps.attendeeEmail],
        set: {
          eventTitle: input.event.title,
          eventStart: start,
          eventEnd: end && !Number.isNaN(end.getTime()) ? end : null,
          eventLocation: input.event.location ?? null,
          meetingLink: input.event.meetingLink ?? null,
          expiresAt,
          updatedAt: new Date(),
        },
      }).returning({ id: calendarRsvps.id });

      if (!row) throw new Error("failed to create RSVP invitation");
      const token = createCalendarRsvpToken(row.id, expiresAt);
      links.push({
        email: attendeeEmail,
        token,
        pageUrl: calendarRsvpUrl(token),
        acceptedUrl: calendarRsvpUrl(token, "accepted"),
        declinedUrl: calendarRsvpUrl(token, "declined"),
        tentativeUrl: calendarRsvpUrl(token, "tentative"),
      });
    }

    return { links };
  });

  app.get("/product/calendar-rsvps", async (req) => {
    const input = listSchema.parse(req.query);
    await requireAccountPermission(req.user!.id, input.accountId, "read");
    const rows = await db.select({
      attendeeEmail: calendarRsvps.attendeeEmail,
      response: calendarRsvps.response,
      respondedAt: calendarRsvps.respondedAt,
    }).from(calendarRsvps).where(and(
      eq(calendarRsvps.accountId, input.accountId),
      eq(calendarRsvps.eventId, input.eventId),
    ));
    return { responses: rows };
  });
}
