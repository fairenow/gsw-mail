import { parseEventLinkRequest } from "../booking/request.js";
import { DemoEngine } from "../engine/demo.js";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { EVENT_LINK_SCHEMA } from "../booking/schema.js";
import {
  bookingInputSchema,
  eventLinkSchema,
  slotsForDay,
  horizon,
} from "../booking/policy.js";
import { bookingInvite } from "../booking/invite.js";
import {
  createBookingService,
  publicLink,
  type EventLinkRow,
} from "../booking/service.js";
import type { pool } from "../db/client.js";
import type { EngineCalendarEvent, MailEngine } from "../engine/types.js";
const settings = () =>
  eventLinkSchema.parse({
    name: "Meet with our team",
    slug: "team-meeting",
    calendarId: "calendar-1",
    timeZone: "America/Detroit",
    enabled: true,
    mode: "windows",
    duration: 30,
    allowedDurations: [15, 20, 30, 45, 60],
    windows: [0, 1, 2, 3, 4, 5, 6].map((day) => ({
      day,
      start: "09:00",
      end: "17:00",
    })),
    fixedSlots: [],
    unavailableDates: [],
    approval: "manual",
    phoneRequired: false,
    messageRequired: false,
    noticeHours: 1,
    location: "Office",
    meetingUrl: "",
    generateMeeting: false,
  });
test("availability respects durations, exclusions, notice and six calendar months", () => {
  const s = settings(),
    now = new Date("2026-11-01T00:00:00Z");
  const slots = slotsForDay(s, "2026-11-02", 20, [], now);
  assert.equal(slots[0]?.start, "2026-11-02T14:00:00.000Z");
  assert.equal(slots[0]?.end, "2026-11-02T14:20:00.000Z");
  assert.ok(
    !slotsForDay(
      s,
      "2026-11-02",
      20,
      [{ start: slots[0]!.start, end: slots[0]!.end }],
      now,
    ).some((slot) => slot.start === slots[0]!.start),
  );
  assert.deepEqual(
    slotsForDay(
      { ...s, unavailableDates: ["2026-11-02"] },
      "2026-11-02",
      20,
      [],
      now,
    ),
    [],
  );
  assert.deepEqual(slotsForDay(s, "2027-05-02", 30, [], now), []);
  assert.deepEqual(slotsForDay(s, "2026-11-02", 25, [], now), []);
  assert.deepEqual(
    slotsForDay({ ...s, noticeHours: 72 }, "2026-11-02", 30, [], now),
    [],
  );
  assert.equal(
    horizon(new Date("2026-08-31T12:00:00Z"), "UTC").last,
    "2027-02-28",
  );
});
test("fixed slots and daylight-saving transitions do not invent invalid times", () => {
  const s = {
    ...settings(),
    mode: "fixed" as const,
    fixedSlots: [
      { date: "2027-03-14", start: "02:30" },
      { date: "2027-03-14", start: "09:00" },
    ],
  };
  const slots = slotsForDay(
    s,
    "2027-03-14",
    30,
    [],
    new Date("2026-11-15T00:00:00Z"),
  );
  assert.equal(slots.length, 1);
  assert.equal(slots[0]?.start, "2027-03-14T13:00:00.000Z");
  assert.deepEqual(
    slotsForDay(s, "2027-03-14", 15, [], new Date("2026-11-15T00:00:00Z")),
    [],
  );
  assert.equal(
    eventLinkSchema.safeParse({
      ...settings(),
      windows: [{ day: 1, start: "17:00", end: "09:00" }],
    }).success,
    false,
  );
});
test("calendar attachment uses UTC and escapes untrusted text and folded UTF-8", () => {
  const attachment = bookingInvite({
    id: randomUUID(),
    title: "Guest, booking\nBEGIN:VEVENT" + "é".repeat(100),
    start: new Date("2026-11-20T15:00:00Z"),
    end: new Date("2026-11-20T15:30:00Z"),
    location: "Office; desk",
    meetingUrl: "https://example.test/meet",
  });
  const content = Buffer.from(attachment.content!, "base64").toString();
  assert.ok(content.includes("DTSTART:20261120T150000Z"));
  assert.equal(
    content.split("\r\n").filter((s) => s === "BEGIN:VEVENT").length,
    1,
  );
  assert.ok(content.includes("Guest\\, booking\\nBEGIN:VEVENT"));
  for (const line of content.split("\r\n"))
    assert.ok(Buffer.byteLength(line) <= 75);
});
test("booking persistence prevents duplicate/cross-link reservations and queues both parties without synchronous delivery", async (t) => {
  const pg = new PGlite(),
    accountId = randomUUID(),
    otherAccount = randomUUID();
  let tail = Promise.resolve();
  const query = (sql: string, values?: unknown[]) => pg.query(sql, values);
  const database = {
    query,
    connect: async () => {
      const previous = tail;
      let release!: () => void;
      tail = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      return { query, release };
    },
  } as unknown as typeof pool;
  const events: EngineCalendarEvent[] = [],
    sent: { to: string[]; subject: string }[] = [];
  let failCalendar = false;
  const engine = Object.assign(new DemoEngine(), {
    listBookingCalendarEvents: async () => events,
    createCalendarEvent: async (
      _account: string,
      input: Parameters<MailEngine["createCalendarEvent"]>[1],
    ) => {
      if (failCalendar) throw Error("calendar unreachable");
      const event: EngineCalendarEvent = {
        uid: input.uid,
        engineId: randomUUID(),
        calendarIds: [input.calendarId],
        title: input.title,
        start: input.start + "Z",
        end: new Date(
          Date.parse(input.start + "Z") + input.durationMinutes * 60000,
        ).toISOString(),
        allDay: false,
        attendees: input.attendees,
      };
      events.push(event);
      return event;
    },
  });
  const service = createBookingService({
    database,
    authorize: async (userId, id) => {
      if (userId !== "owner" || id !== accountId) throw Error("forbidden");
      return {
        id,
        address: "owner@example.test",
        organizationId: randomUUID(),
        status: "active",
        authSetupStatus: "ready",
        role: "owner",
        permissions: ["read", "send", "manage"],
        displayName: "Owner",
        domainId: randomUUID(),
      };
    },
    engine: async () => engine,
    send: async (input) => {
      sent.push({ to: input.to, subject: input.subject ?? "" });
      return {
        sendId: randomUUID(),
        messageId: null,
        threadId: null,
        transportStatus: "queued",
        undoUntil: null,
      };
    },
  });
  try {
    await pg.exec(
      "CREATE TABLE users(id text PRIMARY KEY); CREATE TABLE email_accounts(id uuid PRIMARY KEY,address text);",
    );
    await pg.query("INSERT INTO users VALUES('owner')");
    await pg.query(
      "INSERT INTO email_accounts VALUES($1,'owner@example.test'),($2,'other@example.test')",
      [accountId, otherAccount],
    );
    await pg.exec(EVENT_LINK_SCHEMA);
    await pg.exec(EVENT_LINK_SCHEMA);
    const day = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10),
      s = settings(),
      linkId = randomUUID();
    const insert = async (id: string, slug: string) => {
      const x = { ...s, slug };
      await pg.query(
        "INSERT INTO event_links(id,account_id,user_id,auth_user_id,slug,settings) VALUES($1,$2,'owner','auth-owner',$3,$4)",
        [id, accountId, slug, JSON.stringify(x)],
      );
      return {
        id,
        account_id: accountId,
        user_id: "owner",
        auth_user_id: "auth-owner",
        slug,
        settings: x,
      } satisfies EventLinkRow;
    };
    const link = await insert(linkId, "team-meeting"),
      link2 = await insert(randomUUID(), "other-meeting");
    const slot = slotsForDay(s, day, 30, [])[0]!;
    const input = bookingInputSchema.parse({
      requestId: randomUUID(),
      start: slot.start,
      duration: 30,
      name: "Visitor",
      email: "guest@example.test",
    });
    await t.test(
      "public metadata contains no calendar names, credentials or guest information",
      () => {
        const shape = JSON.stringify(publicLink(link));
        assert.ok(!shape.includes("auth-owner"));
        assert.ok(!shape.includes("calendar-1"));
        assert.ok(!shape.includes("owner@example"));
      },
    );
    await t.test(
      "manual request is durable, retries are idempotent and email is outboxed",
      async () => {
        const concurrent = await Promise.allSettled([
          service.submitBooking(link, input),
          service.submitBooking(link2, { ...input, requestId: randomUUID() }),
        ]);
        assert.equal(
          concurrent.filter((r) => r.status === "fulfilled").length,
          1,
        );
        assert.equal(concurrent[0]?.status, "fulfilled");
        assert.equal(
          (await service.submitBooking(link, input)).status,
          "pending",
        );
        assert.equal(
          (
            await pg.query<{ count: number }>(
              "SELECT count(*)::int AS count FROM event_bookings",
            )
          ).rows[0]!.count,
          1,
        );
        assert.equal(
          (
            await pg.query<{ count: number }>(
              "SELECT count(*)::int AS count FROM event_booking_mail",
            )
          ).rows[0]!.count,
          2,
        );
        assert.equal(sent.length, 0);
        await assert.rejects(
          service.submitBooking(link, { ...input, name: "Changed" }),
          /refresh/,
        );
        await assert.rejects(
          service.submitBooking(link2, { ...input, requestId: randomUUID() }),
          /no longer available/,
        );
      },
    );
    const b = (await pg.query<{ id: string }>("SELECT id FROM event_bookings"))
      .rows[0]!;
    await t.test(
      "another mailbox owner cannot decide the request",
      async () => {
        await assert.rejects(
          service.decideBooking("other", accountId, b.id, "approve"),
          /forbidden/,
        );
        await assert.rejects(
          service.decideBooking("owner", otherAccount, b.id, "approve"),
          /forbidden/,
        );
      },
    );
    await t.test(
      "approval creates one event, confirms both recipients and repeated workers do not resend",
      async () => {
        await service.decideBooking("owner", accountId, b.id, "approve");
        await service.deliverBookingWork();
        await service.deliverBookingWork();
        assert.equal(events.length, 1);
        assert.equal(
          (
            await pg.query<{ status: string }>(
              "SELECT status FROM event_bookings WHERE id=$1",
              [b.id],
            )
          ).rows[0]!.status,
          "confirmed",
        );
        assert.equal(
          sent.filter((m) => m.subject.startsWith("Booking confirmed")).length,
          2,
        );
        assert.equal(sent.length, 4);
        await assert.rejects(
          service.decideBooking("owner", accountId, b.id, "approve"),
          /already been processed/,
        );
      },
    );
    await t.test(
      "required fields, paused links and live calendar conflicts are enforced on the server",
      async () => {
        const required = {
          ...link,
          settings: { ...s, phoneRequired: true, messageRequired: true },
        };
        await assert.rejects(
          service.submitBooking(required, {
            ...input,
            requestId: randomUUID(),
            start: slotsForDay(s, day, 30, [])[10]!.start,
          }),
          /Phone/,
        );
        await pg.query(
          "UPDATE event_links SET settings=jsonb_set(settings,'{enabled}','false') WHERE id=$1",
          [link.id],
        );
        await assert.rejects(service.findLink(link.slug), /unavailable/);
        await pg.query(
          "UPDATE event_links SET settings=jsonb_set(settings,'{enabled}','true') WHERE id=$1",
          [link.id],
        );
        const taken = slotsForDay(s, day, 30, [])[15]!;
        events.push({
          engineId: randomUUID(),
          calendarIds: ["another-calendar"],
          title: "Private event",
          start: taken.start,
          end: taken.end,
          attendees: [],
          allDay: false,
        });
        await assert.rejects(
          service.submitBooking(link, {
            ...input,
            requestId: randomUUID(),
            start: taken.start,
          }),
          /no longer available/,
        );
      },
    );
    await t.test(
      "automatic approval, expiry and failed calendar creation have honest states",
      async () => {
        const auto = {
          ...link2,
          settings: { ...link2.settings, approval: "auto" as const },
        };
        await pg.query("UPDATE event_links SET settings=$2 WHERE id=$1", [
          auto.id,
          JSON.stringify(auto.settings),
        ]);
        const free = slotsForDay(
          s,
          day,
          30,
          events.map((e) => ({ start: e.start, end: e.end! })),
        )[0]!;
        const result = await service.submitBooking(auto, {
          ...input,
          requestId: randomUUID(),
          start: free.start,
        });
        assert.equal(result.status, "approved");
        failCalendar = true;
        await service.deliverBookingWork();
        assert.equal(
          (
            await pg.query<{ status: string }>(
              "SELECT status FROM event_bookings WHERE link_id=$1",
              [auto.id],
            )
          ).rows[0]!.status,
          "attention",
        );
        const pending = await service.submitBooking(link, {
          ...input,
          requestId: randomUUID(),
          start: slotsForDay(
            s,
            day,
            30,
            events.map((e) => ({ start: e.start, end: e.end! })),
          )[10]!.start,
        });
        assert.equal(pending.status, "pending");
        await pg.query(
          "UPDATE event_bookings SET hold_until=now()-interval '1 minute' WHERE status='pending'",
        );
        await service.deliverBookingWork();
        assert.equal(
          (
            await pg.query<{ count: number }>(
              "SELECT count(*)::int AS count FROM event_bookings WHERE status='expired'",
            )
          ).rows[0]!.count,
          1,
        );
      },
    );
    await t.test(
      "deleting a mailbox removes its private booking metadata and notification outbox",
      async () => {
        await pg.query("DELETE FROM email_accounts WHERE id=$1", [accountId]);
        for (const table of [
          "event_links",
          "event_bookings",
          "event_booking_mail",
        ]) {
          assert.equal(
            (
              await pg.query<{ count: number }>(
                `SELECT count(*)::int AS count FROM ${table}`,
              )
            ).rows[0]!.count,
            0,
          );
        }
      },
    );
  } finally {
    await pg.close();
  }
});

test("event link submission normalizes blank exclusions and inactive scheduling drafts", () => {
  const base = settings(),
    accountId = randomUUID();
  const parsed = parseEventLinkRequest({
    accountId,
    settings: {
      ...base,
      unavailableDates: ["", "  ", " 2026-12-25 "],
      fixedSlots: [{ date: "", start: "09:00" }],
    },
  });
  assert.deepEqual(parsed.settings.unavailableDates, ["2026-12-25"]);
  assert.deepEqual(parsed.settings.fixedSlots, []);
  const fixed = parseEventLinkRequest({
    accountId,
    settings: {
      ...base,
      mode: "fixed",
      duration: 45,
      fixedSlots: [{ date: "2026-12-01", start: "10:00" }],
      allowedDurations: [],
      windows: [{ day: 1, start: "", end: "" }],
    },
  });
  assert.deepEqual(fixed.settings.allowedDurations, [45]);
  assert.deepEqual(fixed.settings.windows, []);
  assert.throws(
    () =>
      parseEventLinkRequest({
        accountId,
        settings: { ...base, unavailableDates: ["2026-02-31"] },
      }),
    /Unavailable date 1/,
  );
  assert.throws(
    () =>
      parseEventLinkRequest({
        accountId,
        settings: {
          ...base,
          mode: "fixed",
          fixedSlots: [{ date: "", start: "09:00" }],
        },
      }),
    /Exact slot 1/,
  );
  assert.throws(
    () =>
      parseEventLinkRequest({
        accountId,
        settings: { ...base, allowedDurations: [] },
      }),
    /Select at least one/,
  );
});
