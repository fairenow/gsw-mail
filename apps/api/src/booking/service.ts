import { bookingNotice } from "./notice.js";
import { bookingInvite } from "./invite.js";
import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { pool as productionPool } from "../db/client.js";
import { requireAccountPermission as authorizeMailbox } from "../auth/authorize.js";
import { getUserEngine as resolveEngine } from "../engine/index.js";
import {
  badRequest,
  conflict,
  notFound,
  serviceUnavailable,
  tooManyRequests,
} from "../lib/errors.js";
import { meetingOrganizer } from "../meetings/access.js";
import { createMeetingClient } from "../meetings/client.js";
import {
  dayInZone,
  horizon,
  overlaps,
  slotsForDay,
  validateGuest,
  type LinkSettings,
  type Interval,
  bookingInputSchema,
} from "./policy.js";
import { submitSend as enqueueSend } from "../outbound/sendFlow.js";
export type EventLinkRow = {
  id: string;
  account_id: string;
  user_id: string;
  auth_user_id: string;
  slug: string;
  settings: LinkSettings;
};
export type BookingRow = {
  id: string;
  link_id: string;
  account_id: string;
  settings: LinkSettings;
  name: string;
  email: string;
  phone: string;
  message: string;
  starts_at: Date;
  ends_at: Date;
  status: string;
  hold_until: Date;
  event_id: string | null;
  meeting_url: string | null;
  payload_hash: string;
};
type Database = Pick<PoolClient, "query">;
const origin = "https://mail.guidedstepswellness.com";
export const linkUrl = (slug: string) => `${origin}/book/${slug}`;
export const publicLink = (row: EventLinkRow) => ({
  name: row.settings.name,
  slug: row.slug,
  timeZone: row.settings.timeZone,
  mode: row.settings.mode,
  duration: row.settings.duration,
  allowedDurations: row.settings.allowedDurations,
  phoneRequired: row.settings.phoneRequired,
  messageRequired: row.settings.messageRequired,
  approval: row.settings.approval,
  location: row.settings.location,
  ...horizon(new Date(), row.settings.timeZone),
});
export function createBookingService(
  dependencies: {
    database?: typeof productionPool;
    authorize?: typeof authorizeMailbox;
    engine?: typeof resolveEngine;
    send?: typeof enqueueSend;
  } = {},
) {
  const pool = dependencies.database ?? productionPool;
  const requireAccountPermission = dependencies.authorize ?? authorizeMailbox;
  const getUserEngine = dependencies.engine ?? resolveEngine;
  const submitSend = dependencies.send ?? enqueueSend;
  async function engineFor(link: EventLinkRow) {
    await requireAccountPermission(link.user_id, link.account_id, "manage");
    return getUserEngine({
      productUserId: link.user_id,
      authUserId: link.auth_user_id,
      accountId: link.account_id,
      headers: {},
      permission: "manage",
    });
  }
  async function findLink(slug: string) {
    const { rows } = await pool.query<EventLinkRow>(
      "SELECT * FROM event_links WHERE slug=$1",
      [slug],
    );
    const row = rows[0];
    if (!row || !row.settings.enabled)
      throw notFound("This booking link is unavailable");
    return row;
  }
  async function withCalendarLock<T>(
    accountId: string,
    fn: (c: PoolClient) => Promise<T>,
  ) {
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        "event-booking:" + accountId,
      ]);
      const value = await fn(c);
      await c.query("COMMIT");
      return value;
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }
  async function bookingBusy(db: Database, accountId: string, ignore?: string) {
    const { rows } = await db.query<{ starts_at: Date; ends_at: Date }>(
      `SELECT starts_at,ends_at FROM event_bookings WHERE account_id=$1 AND id IS DISTINCT FROM $2::uuid AND (status IN ('approved','creating','confirmed','attention') OR (status='pending' AND hold_until>now()))`,
      [accountId, ignore ?? null],
    );
    return rows.map((r) => ({
      start: r.starts_at.toISOString(),
      end: r.ends_at.toISOString(),
    }));
  }
  async function calendarEvents(
    link: EventLinkRow,
    day: string,
    until?: string,
  ) {
    const engine = await engineFor(link);
    const start = new Date(day + "T00:00:00Z"),
      end = new Date((until ?? day) + "T00:00:00Z");
    start.setUTCDate(start.getUTCDate() - 2);
    end.setUTCDate(end.getUTCDate() + (until ? 2 : 3));
    return {
      engine,
      events: await engine.listBookingCalendarEvents(
        link.account_id,
        start.toISOString(),
        end.toISOString(),
      ),
    };
  }
  async function availableDays(
    link: EventLinkRow,
    month: string,
    duration: number,
  ) {
    const bounds = horizon(new Date(), link.settings.timeZone);
    if (
      !/^\d{4}-(0[1-9]|1[0-2])$/.test(month) ||
      month < bounds.first.slice(0, 7) ||
      month > bounds.last.slice(0, 7)
    )
      throw badRequest("Choose a month in the next six months");
    const { events } = await calendarEvents(
      link,
      month + "-01",
      new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 1))
        .toISOString()
        .slice(0, 10),
    );
    const busy: Interval[] = [
      ...events.map((e) => ({ start: e.start, end: e.end! })),
      ...(await bookingBusy(pool, link.account_id)),
    ];
    const count = new Date(
        Number(month.slice(0, 4)),
        Number(month.slice(5)),
        0,
      ).getDate(),
      days: Record<string, Interval[]> = {};
    for (let d = 1; d <= count; d++) {
      const day = month + "-" + String(d).padStart(2, "0");
      days[day] = slotsForDay(link.settings, day, duration, busy);
    }
    return { days, ...bounds, timeZone: link.settings.timeZone };
  }
  async function queueNotices(
    db: Database,
    link: EventLinkRow,
    b: BookingRow,
    stage: string,
  ) {
    const { rows } = await db.query<{ address: string }>(
      "SELECT address FROM email_accounts WHERE id=$1",
      [link.account_id],
    );
    if (!rows[0]) throw Error("Mailbox no longer exists");
    for (const recipient of [b.email, rows[0].address]) {
      const notice = bookingNotice(
        link,
        b,
        stage,
        rows[0].address,
        recipient === rows[0].address,
      );
      await db.query(
        `INSERT INTO event_booking_mail(booking_id,notification_key,recipient,subject,body) VALUES($1,$2,$3,$4,$5) ON CONFLICT(notification_key) DO NOTHING`,
        [
          b.id,
          `${b.id}:${stage}:${recipient}`,
          recipient,
          notice.subject,
          notice.text,
        ],
      );
    }
  }
  async function submitBooking(link: EventLinkRow, raw: unknown) {
    const input = bookingInputSchema.parse(raw);
    try {
      validateGuest(link.settings, input);
    } catch (e) {
      throw badRequest((e as Error).message);
    }
    const hash = createHash("sha256")
      .update(JSON.stringify(input))
      .digest("hex");
    return withCalendarLock(link.account_id, async (db) => {
      const fresh = await db.query<EventLinkRow>(
        "SELECT * FROM event_links WHERE id=$1 FOR SHARE",
        [link.id],
      );
      link = fresh.rows[0]!;
      if (!link?.settings.enabled)
        throw notFound("This booking link is unavailable");
      try {
        validateGuest(link.settings, input);
      } catch (e) {
        throw badRequest((e as Error).message);
      }
      const old = await db.query<BookingRow>(
        "SELECT * FROM event_bookings WHERE link_id=$1 AND request_id=$2",
        [link.id, input.requestId],
      );
      if (old.rows[0]) {
        if (old.rows[0].payload_hash !== hash)
          throw conflict("Please refresh before making a different booking");
        return { status: old.rows[0].status };
      }
      const rate = await db.query<{ count: string }>(
        "SELECT count(*) FROM event_bookings WHERE account_id=$1 AND created_at>now()-interval '1 day'",
        [link.account_id],
      );
      if (Number(rate.rows[0]?.count) >= 100)
        throw tooManyRequests("This booking page is temporarily at capacity");
      const day = dayInZone(new Date(input.start), link.settings.timeZone);
      const { events } = await calendarEvents(link, day);
      const busy: Interval[] = [
        ...events.map((e) => ({ start: e.start, end: e.end! })),
        ...(await bookingBusy(db, link.account_id)),
      ];
      const slot = slotsForDay(link.settings, day, input.duration, busy).find(
        (s) => s.start === input.start,
      );
      if (!slot)
        throw conflict(
          "This time is no longer available. Please choose another time.",
        );
      const id = randomUUID(),
        status = link.settings.approval === "auto" ? "approved" : "pending";
      const inserted = await db.query<BookingRow>(
        `INSERT INTO event_bookings(id,link_id,account_id,request_id,payload_hash,settings,name,email,phone,message,starts_at,ends_at,status,hold_until) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,LEAST($11::timestamptz,now()+interval '24 hours')) RETURNING *`,
        [
          id,
          link.id,
          link.account_id,
          input.requestId,
          hash,
          link.settings,
          input.name,
          input.email,
          input.phone,
          input.message,
          slot.start,
          slot.end,
          status,
        ],
      );
      if (status === "pending")
        await queueNotices(db, link, inserted.rows[0]!, "pending");
      return { status };
    });
  }
  async function decideBooking(
    userId: string,
    accountId: string,
    id: string,
    decision: "approve" | "decline",
  ) {
    await requireAccountPermission(userId, accountId, "manage");
    return withCalendarLock(accountId, async (db) => {
      const { rows } = await db.query<BookingRow>(
        "SELECT * FROM event_bookings WHERE id=$1 AND account_id=$2 FOR UPDATE",
        [id, accountId],
      );
      const b = rows[0];
      if (!b) throw notFound();
      if (!["pending", "attention"].includes(b.status))
        throw conflict("This request has already been processed");
      if (
        decision === "approve" &&
        (b.hold_until <= new Date() || b.starts_at <= new Date())
      )
        throw conflict("This request has expired");
      if (decision === "approve" && b.status === "attention")
        throw conflict(
          "Calendar creation needs review. Check the calendar before declining this request.",
        );
      const link = (
        await db.query<EventLinkRow>("SELECT * FROM event_links WHERE id=$1", [
          b.link_id,
        ])
      ).rows[0]!;
      const status = decision === "approve" ? "approved" : "declined";
      await db.query(
        "UPDATE event_bookings SET status=$2,updated_at=now() WHERE id=$1",
        [id, status],
      );
      if (status === "declined") await queueNotices(db, link, b, status);
      return { status };
    });
  }
  async function deliverBookingWork() {
    const due = await pool.query<BookingRow>(
      `SELECT * FROM event_bookings WHERE (status='pending' AND hold_until<=now()) OR (status='creating' AND claimed_at<now()-interval '10 minutes') LIMIT 50`,
    );
    for (const row of due.rows)
      await withCalendarLock(row.account_id, async (db) => {
        const changed = await db.query<BookingRow>(
          `UPDATE event_bookings SET status=CASE WHEN status='pending' THEN 'expired' ELSE 'attention' END,updated_at=now() WHERE id=$1 AND ((status='pending' AND hold_until<=now()) OR (status='creating' AND claimed_at<now()-interval '10 minutes')) RETURNING *`,
          [row.id],
        );
        const booking = changed.rows[0];
        if (!booking) return;
        const link = (
          await db.query<EventLinkRow>(
            "SELECT * FROM event_links WHERE id=$1",
            [booking.link_id],
          )
        ).rows[0];
        if (link) await queueNotices(db, link, booking, booking.status);
      });
    const jobs = await pool.query<BookingRow>(
      `SELECT * FROM event_bookings WHERE status='approved' ORDER BY created_at LIMIT 10`,
    );
    for (const job of jobs.rows) await processBooking(job);
    await deliverBookingMail();
  }
  async function processBooking(job: BookingRow) {
    await withCalendarLock(job.account_id, async (db) => {
      const claim = await db.query<BookingRow>(
        `UPDATE event_bookings SET status='creating',claimed_at=now(),updated_at=now() WHERE id=$1 AND status='approved' RETURNING *`,
        [job.id],
      );
      const b = claim.rows[0];
      if (!b) return;
      const link = (
        await db.query<EventLinkRow>("SELECT * FROM event_links WHERE id=$1", [
          b.link_id,
        ])
      ).rows[0];
      if (!link) return;
      try {
        if (b.starts_at <= new Date()) {
          await db.query(
            "UPDATE event_bookings SET status='expired',updated_at=now() WHERE id=$1",
            [b.id],
          );
          await queueNotices(db, link, b, "expired");
          return;
        }
        const { engine, events } = await calendarEvents(
          link,
          dayInZone(b.starts_at, b.settings.timeZone),
        );
        const uid = `gsw-booking-${b.id}`,
          existing = events.find((e) => e.uid === uid),
          interval = {
            start: b.starts_at.toISOString(),
            end: b.ends_at.toISOString(),
          };
        if (
          !existing &&
          events.some((e) =>
            overlaps(interval, { start: e.start, end: e.end! }),
          )
        ) {
          await db.query(
            "UPDATE event_bookings SET status='declined',updated_at=now() WHERE id=$1",
            [b.id],
          );
          await queueNotices(db, link, b, "declined");
          return;
        }
        if (!existing) {
          let meetingLink = b.settings.meetingUrl;
          if (b.settings.generateMeeting) {
            if (process.env.GSW_MEETINGS_ENABLED !== "true")
              throw serviceUnavailable("Meeting generation is unavailable");
            const organizer = await meetingOrganizer(
              link.user_id,
              link.account_id,
            );
            const client = createMeetingClient({
              apiUrl: process.env.GSW_MEETINGS_API_URL ?? "",
              webOrigin: process.env.GSW_MEETINGS_WEB_ORIGIN ?? "",
              signingSecret: process.env.GSW_MEETINGS_SIGNING_SECRET ?? "",
            });
            const room = await client.createRoom(organizer, {
              externalEventId: `booking:${b.id}`,
              title: b.settings.name,
              scheduledAt: b.starts_at.toISOString(),
              timezone: b.settings.timeZone,
            });
            meetingLink = room.joinUrl;
          }
          b.meeting_url = meetingLink || null;
          const event = await engine.createCalendarEvent(link.account_id, {
            uid,
            calendarId: b.settings.calendarId,
            title: `${b.settings.name} — ${b.name}`,
            description: `Booked by ${b.name}\nEmail: ${b.email}\nPhone: ${b.phone}\n${b.message}`,
            start: b.starts_at.toISOString().slice(0, 19),
            timeZone: "Etc/UTC",
            durationMinutes:
              (b.ends_at.getTime() - b.starts_at.getTime()) / 60000,
            location: b.settings.location,
            meetingLink: meetingLink || undefined,
            attendees: [b.email],
            sendSchedulingMessages: false,
            allDay: false,
          });
          b.event_id = event.engineId;
        } else {
          b.event_id = existing.engineId;
          b.meeting_url = existing.meetingLink ?? b.settings.meetingUrl ?? null;
        }
        await db.query(
          "UPDATE event_bookings SET status='confirmed',event_id=$2,meeting_url=$3,updated_at=now() WHERE id=$1",
          [b.id, b.event_id, b.meeting_url],
        );
        await queueNotices(db, link, b, "confirmed");
      } catch {
        await db.query(
          "UPDATE event_bookings SET status='attention',updated_at=now() WHERE id=$1",
          [b.id],
        );
        await queueNotices(db, link, b, "attention");
      }
    });
  }
  async function deliverBookingMail() {
    await pool.query(
      `UPDATE event_booking_mail SET status='attention' WHERE status='sending' AND claimed_at<now()-interval '10 minutes'`,
    );
    const { rows } = await pool.query<{
      id: string;
      booking_id: string;
      notification_key: string;
      recipient: string;
      subject: string;
      body: string;
    }>(
      `UPDATE event_booking_mail SET status='sending',claimed_at=now(),attempts=attempts+1 WHERE id IN (SELECT id FROM event_booking_mail WHERE status='pending' ORDER BY created_at LIMIT 20 FOR UPDATE SKIP LOCKED) RETURNING *`,
    );
    for (const mail of rows) {
      try {
        const link = (
          await pool.query<EventLinkRow>(
            "SELECT l.* FROM event_links l JOIN event_bookings b ON b.link_id=l.id WHERE b.id=$1",
            [mail.booking_id],
          )
        ).rows[0];
        if (!link) throw Error("Booking not found");
        const account = await requireAccountPermission(
          link.user_id,
          link.account_id,
          "send",
        );
        const b = (
          await pool.query<BookingRow>(
            "SELECT * FROM event_bookings WHERE id=$1",
            [mail.booking_id],
          )
        ).rows[0]!;
        const attachments =
          mail.notification_key.includes(":confirmed:") &&
          mail.recipient === b.email
            ? [
                bookingInvite({
                  id: b.id,
                  title: b.settings.name,
                  start: b.starts_at,
                  end: b.ends_at,
                  location: b.settings.location,
                  meetingUrl: b.meeting_url || b.settings.meetingUrl,
                }),
              ]
            : undefined;
        const stage = mail.notification_key.split(":")[1] ?? "attention";
        const notice = bookingNotice(
          link,
          b,
          stage,
          account.address,
          mail.recipient === account.address,
        );
        const sent = await submitSend({
          userId: link.user_id,
          authUserId: link.auth_user_id,
          headers: {},
          account,
          to: [mail.recipient],
          subject: notice.subject,
          textBody: notice.text,
          htmlBody: notice.html,
          preserveTextBody: true,
          templateKey: "none",
          attachments,
          clientRequestId: `event-booking-mail:${mail.id}`,
        });
        if (!["queued", "sending", "accepted"].includes(sent.transportStatus))
          throw Error("Message requires review");
        await pool.query(
          "UPDATE event_booking_mail SET status='queued',send_id=$2 WHERE id=$1",
          [mail.id, sent.sendId],
        );
      } catch {
        await pool.query(
          "UPDATE event_booking_mail SET status='attention' WHERE id=$1",
          [mail.id],
        );
      }
    }
  }

  return {
    findLink,
    withCalendarLock,
    availableDays,
    submitBooking,
    decideBooking,
    deliverBookingWork,
  };
}
export const {
  findLink,
  withCalendarLock,
  availableDays,
  submitBooking,
  decideBooking,
  deliverBookingWork,
} = createBookingService();
