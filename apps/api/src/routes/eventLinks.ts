import { communityProofSchema,verifyCommunityRegistration } from "../booking/communityRegistration.js";
import { bookingInputSchema } from "../booking/policy.js";
import { redeemNativeOwnerCode } from "../meetings/nativeOwnerCode.js";
import { redeemOwnerCode } from "../meetings/ownerCode.js";
import { verifyBookingDecisionToken } from "../booking/decisionToken.js";
import { JmapError } from "../engine/jmap.js";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser } from "../auth/middleware.js";
import { requireAccountPermission } from "../auth/authorize.js";
import { pool } from "../db/client.js";
import {
  HttpError,
  badRequest,
  conflict,
  forbidden,
  notFound,
  serviceUnavailable,
} from "../lib/errors.js";
import { saveManagedEventLink,listManagedEventLinks } from "../booking/manageLinks.js";
import {
  availableDays,
  decideBooking,
  findLink,
  publicLink,
  submitBooking,
} from "../booking/service.js";
const accountQuery = z.object({ accountId: z.uuid() });
export async function publicEventLinks(app: FastifyInstance) {
  app.addHook("onSend", async (_req, reply, payload) => {
    reply.header("cache-control", "no-store");
    reply.header("x-robots-tag", "noindex, nofollow");
    return payload;
  });
  app.post("/product/calendar-meetings/verify-owner", { bodyLimit: 512, config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    if (process.env.GSW_MEETINGS_ENABLED !== "true") throw serviceUnavailable("meetings_disabled");
    const input = z.object({ meetingId: z.string().regex(/^[a-zA-Z0-9_-]{1,200}$/), code: z.string().regex(/^[0-9]{8}$/) }).strict().parse(req.body);
    try {
      const result = await redeemOwnerCode(input.meetingId, input.code);
      if (result) return result;
    } catch {}
    return reply.code(401).send({ code: "owner_code_invalid" });
  });
  app.post("/product/calendar-meetings/verify-owner-native", { bodyLimit: 768, config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    if (process.env.GSW_MEETINGS_ENABLED !== "true") throw serviceUnavailable("meetings_disabled");
    const input = z.object({ meetingId: z.string().regex(/^[a-zA-Z0-9_-]{1,200}$/), code: z.string().regex(/^[0-9]{8}$/), requestId: z.uuid() }).strict().parse(req.body);
    try {
      const session = await redeemNativeOwnerCode(input.meetingId, input.code, input.requestId);
      if (session) return session;
      return reply.code(401).send({code:"owner_code_invalid"});
    } catch {
      return reply.code(503).send({code:"meeting_verification_unavailable"});
    }
  });
  const decisionRequest = z
    .object({
      token: z.string().max(2000),
      decision: z.enum(["approve", "decline"]).optional(),
    })
    .strict();
  const resolveDecision = async (raw: unknown) => {
    const input = decisionRequest.parse(raw);
    const claims = verifyBookingDecisionToken(input.token);
    if (!claims)
      throw forbidden(
        "This approval link is invalid or expired. Open the latest booking email.",
      );
    const { rows } = await pool.query<{
      name: string;
      email: string;
      starts_at: Date;
      status: string;
      hold_until: Date;
      settings: { name: string; timeZone: string };
    }>(
      "SELECT b.name,b.email,b.starts_at,b.status,b.hold_until,b.settings FROM event_bookings b JOIN event_links l ON l.id=b.link_id WHERE b.id=$1 AND b.account_id=$2 AND l.user_id=$3 AND l.settings->>'enabled'='true'",
      [claims.id, claims.accountId, claims.userId],
    );
    const booking = rows[0];
    if (!booking) throw notFound("This booking is no longer available.");
    await requireAccountPermission(claims.userId, claims.accountId, "manage");
    return { input, claims, booking };
  };
  app.post(
    "/product/event-links/decision-preview",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (req) => {
      const { booking } = await resolveDecision(req.body);
      return {
        name: booking.name,
        email: booking.email,
        title: booking.settings.name,
        timeZone: booking.settings.timeZone,
        start: booking.starts_at,
        status: booking.status,
        expiresAt: booking.hold_until,
      };
    },
  );
  app.post(
    "/product/event-links/decision",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (req) => {
      const { input, claims } = await resolveDecision(req.body);
      if (!input.decision) throw badRequest("Choose approve or decline.");
      return decideBooking(
        claims.userId,
        claims.accountId,
        claims.id,
        input.decision,
      );
    },
  );
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
      const {communityProof,...raw}=bookingInputSchema.extend({communityProof:communityProofSchema.optional()}).strict().parse(req.body);
      const link=await findLink(slug);
      if(communityProof)await verifyCommunityRegistration({linkId:link.id,requestId:raw.requestId,email:raw.email,proof:communityProof});
      const result = await submitBooking(link,raw,Boolean(communityProof));
      return reply.code(201).send(result);
    },
  );
}
export default async function eventLinks(app: FastifyInstance) {
  await requireUser(app, { optional: false });
  app.get("/product/event-links", async req=>listManagedEventLinks(req.user!.id,accountQuery.parse(req.query).accountId));
  app.post("/product/event-links", { bodyLimit: 50000 }, async (req) => saveManagedEventLink({userId:req.user!.id,authUserId:req.authUserId,headers:req.headers as Record<string,string>},req.body));
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
