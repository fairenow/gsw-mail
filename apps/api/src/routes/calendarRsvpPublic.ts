import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db/client.js";
import { calendarRsvps } from "../db/schema.js";
import { verifyCalendarRsvpToken } from "../lib/calendarRsvp.js";

const querySchema = z.object({ token: z.string().min(20) });
const responseSchema = z.object({
  token: z.string().min(20),
  response: z.enum(["accepted", "declined", "tentative"]),
});

const publicShape = (row: typeof calendarRsvps.$inferSelect) => ({
  attendeeEmail: row.attendeeEmail,
  eventTitle: row.eventTitle,
  eventStart: row.eventStart.toISOString(),
  eventEnd: row.eventEnd?.toISOString() ?? null,
  eventLocation: row.eventLocation,
  meetingLink: row.meetingLink,
  response: row.response,
  respondedAt: row.respondedAt?.toISOString() ?? null,
  expiresAt: row.expiresAt.toISOString(),
});

export default async function calendarRsvpPublicRoutes(app: FastifyInstance) {
  app.get("/product/calendar-rsvp", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const { token } = querySchema.parse(req.query);
    const verified = verifyCalendarRsvpToken(token);
    if (!verified) return reply.code(410).send({ error: "This RSVP link is invalid or has expired." });
    const [row] = await db.select().from(calendarRsvps).where(eq(calendarRsvps.id, verified.id)).limit(1);
    if (!row || row.expiresAt.getTime() <= Date.now()) return reply.code(410).send({ error: "This RSVP link is invalid or has expired." });
    return publicShape(row);
  });

  app.post("/product/calendar-rsvp", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req, reply) => {
    const input = responseSchema.parse(req.body);
    const verified = verifyCalendarRsvpToken(input.token);
    if (!verified) return reply.code(410).send({ error: "This RSVP link is invalid or has expired." });
    const [row] = await db.update(calendarRsvps).set({
      response: input.response,
      respondedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(calendarRsvps.id, verified.id)).returning();
    if (!row || row.expiresAt.getTime() <= Date.now()) return reply.code(410).send({ error: "This RSVP link is invalid or has expired." });
    return publicShape(row);
  });
}
