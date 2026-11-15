import { JmapError } from "../engine/jmap.js";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser } from "../auth/middleware.js";
import { requireAccountPermission } from "../auth/authorize.js";
import { pool } from "../db/client.js";
import { getUserEngine } from "../engine/index.js";
import {
  HttpError,
  badRequest,
  conflict,
  forbidden,
  notFound,
  serviceUnavailable,
} from "../lib/errors.js";
import { parseEventLinkRequest } from "../booking/request.js";
import {
  availableDays,
  decideBooking,
  findLink,
  linkUrl,
  publicLink,
  submitBooking,
  withCalendarLock,
  type EventLinkRow,
} from "../booking/service.js";
import { meetingOrganizer } from "../meetings/access.js";
const accountQuery = z.object({ accountId: z.uuid() });
export async function publicEventLinks(app: FastifyInstance) {
  app.addHook("onSend", async (_req, reply, payload) => {
    reply.header("cache-control", "no-store");
    reply.header("x-robots-tag", "noindex, nofollow");
    return payload;
  });
  app.get(
    "/product/event-links/public/:slug",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (req) =>
      publicLink(
        await findLink(
          z.object({ slug: z.string().max(70) }).parse(req.params).slug,
        ),
      ),
  );
  app.get(
    "/product/event-links/public/:slug/slots",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (req) => {
      const { slug } = z.object({ slug: z.string().max(70) }).parse(req.params),
        { month, duration } = z
          .object({ month: z.string(), duration: z.coerce.number().int() })
          .parse(req.query);
      try {
        return await availableDays(await findLink(slug), month, duration);
      } catch (e) {
        if (e instanceof HttpError) throw e;
        req.log.warn(
          {
            reason:
              e instanceof JmapError
                ? e.type
                : e instanceof Error
                  ? [
                      "Calendar availability could not be fully verified",
                      "Calendar changed while checking availability",
                      "Calendar event times could not be verified",
                      "Calendar availability exceeds the verification limit",
                      "Invalid booking calendar range",
                    ].includes(e.message)
                    ? e.message
                    : e.name
                  : "unknown",
          },
          "booking availability verification failed",
        );
        throw serviceUnavailable(
          "Availability is temporarily unavailable. Please try again later.",
        );
      }
    },
  );
  app.post(
    "/product/event-links/public/:slug/book",
    {
      bodyLimit: 10000,
      config: { rateLimit: { max: 5, timeWindow: "1 hour" } },
    },
    async (req, reply) => {
      const { slug } = z.object({ slug: z.string().max(70) }).parse(req.params);
      const result = await submitBooking(await findLink(slug), req.body);
      return reply.code(201).send(result);
    },
  );
}
export default async function eventLinks(app: FastifyInstance) {
  await requireUser(app, { optional: false });
  app.get("/product/event-links", async (req) => {
    const { accountId } = accountQuery.parse(req.query);
    await requireAccountPermission(req.user!.id, accountId, "manage");
    const { rows } = await pool.query<EventLinkRow>(
      "SELECT * FROM event_links WHERE account_id=$1 ORDER BY created_at",
      [accountId],
    );
    return {
      links: rows.map((r) => ({
        id: r.id,
        ...r.settings,
        url: linkUrl(r.slug),
      })),
    };
  });
  app.post("/product/event-links", { bodyLimit: 50000 }, async (req) => {
    const { accountId, id, settings } = parseEventLinkRequest(req.body);
    const account = await requireAccountPermission(
      req.user!.id,
      accountId,
      "manage",
    );
    if (account.status !== "active" || !req.authUserId)
      throw forbidden("Sign in to the mailbox to manage event links");
    if (settings.enabled) {
      const engine = await getUserEngine({
        productUserId: req.user!.id,
        authUserId: req.authUserId,
        accountId,
        headers: req.headers as Record<string, string>,
        permission: "manage",
      });
      const calendars = await engine.listCalendars(accountId);
      if (!calendars.some((c) => c.engineId === settings.calendarId))
        throw badRequest("Choose a calendar belonging to this mailbox");
      await getUserEngine({
        productUserId: req.user!.id,
        authUserId: req.authUserId,
        accountId,
        headers: {},
        permission: "manage",
      });
      if (settings.generateMeeting) {
        if (process.env.GSW_MEETINGS_ENABLED !== "true")
          throw serviceUnavailable("Meeting generation is unavailable");
        await meetingOrganizer(req.user!.id, accountId);
      }
    }
    try {
      return await withCalendarLock(accountId, async (db) => {
        if (id) {
          const result = await db.query<EventLinkRow>(
            "UPDATE event_links SET slug=$3,settings=$4,user_id=$5,auth_user_id=$6,updated_at=now() WHERE id=$1 AND account_id=$2 RETURNING *",
            [
              id,
              accountId,
              settings.slug,
              settings,
              req.user!.id,
              req.authUserId,
            ],
          );
          if (!result.rows[0]) throw notFound();
          return { id, url: linkUrl(settings.slug) };
        }
        const count = await db.query<{ count: string }>(
          "SELECT count(*) FROM event_links WHERE account_id=$1",
          [accountId],
        );
        if (Number(count.rows[0]?.count) >= 20)
          throw badRequest("This mailbox already has 20 event links");
        const result = await db.query<EventLinkRow>(
          "INSERT INTO event_links(account_id,user_id,auth_user_id,slug,settings) VALUES($1,$2,$3,$4,$5) RETURNING *",
          [accountId, req.user!.id, req.authUserId, settings.slug, settings],
        );
        return { id: result.rows[0]!.id, url: linkUrl(settings.slug) };
      });
    } catch (e) {
      if ((e as { code?: string }).code === "23505")
        throw conflict(
          "This booking link name is already taken. Please choose another slug.",
        );
      throw e;
    }
  });
  app.get("/product/event-bookings", async (req) => {
    const { accountId } = accountQuery.parse(req.query);
    await requireAccountPermission(req.user!.id, accountId, "manage");
    const { rows } = await pool.query(
      `SELECT b.id,b.link_id,b.name,b.email,b.phone,b.message,b.starts_at,b.ends_at,b.status,b.hold_until,b.event_id,b.meeting_url,b.settings->>'name' AS link_name,EXISTS(SELECT 1 FROM event_booking_mail m WHERE m.booking_id=b.id AND m.status='attention') AS email_needs_attention FROM event_bookings b WHERE b.account_id=$1 ORDER BY b.created_at DESC LIMIT 100`,
      [accountId],
    );
    return { bookings: rows };
  });
  app.post("/product/event-bookings/:id/retry-email", async (req) => {
    const { id } = z.object({ id: z.uuid() }).parse(req.params),
      { accountId } = accountQuery.parse(req.body);
    await requireAccountPermission(req.user!.id, accountId, "manage");
    const booking = await pool.query(
      "SELECT id FROM event_bookings WHERE id=$1 AND account_id=$2",
      [id, accountId],
    );
    if (!booking.rows[0]) throw notFound();
    await pool.query(
      "UPDATE event_booking_mail SET status='pending' WHERE booking_id=$1 AND status='attention'",
      [id],
    );
    return { queued: true };
  });
  app.post("/product/event-bookings/:id/decision", async (req) => {
    const { id } = z.object({ id: z.uuid() }).parse(req.params),
      { accountId, decision } = z
        .object({
          accountId: z.uuid(),
          decision: z.enum(["approve", "decline"]),
        })
        .strict()
        .parse(req.body);
    return decideBooking(req.user!.id, accountId, id, decision);
  });
}
