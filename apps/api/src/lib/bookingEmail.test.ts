import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { bookingNotice } from "../booking/notice.js";
import {
  createBookingDecisionToken,
  verifyBookingDecisionToken,
} from "../booking/decisionToken.js";
import { eventLinkSchema } from "../booking/policy.js";
import type { BookingRow, EventLinkRow } from "../booking/service.js";
const settings = eventLinkSchema.parse({
  name: "Meeting <team>",
  slug: "team",
  calendarId: "b",
  timeZone: "America/Detroit",
  enabled: true,
  mode: "windows",
  duration: 30,
  allowedDurations: [30],
  windows: [{ day: 1, start: "10:00", end: "15:00" }],
  approval: "manual",
  noticeHours: 4,
  fixedSlots: [],
  unavailableDates: [],
  phoneRequired: false,
  messageRequired: false,
  location: "",
  meetingUrl: "",
  generateMeeting: false,
});
const link: EventLinkRow = {
  id: randomUUID(),
  account_id: randomUUID(),
  user_id: "owner",
  auth_user_id: "auth",
  slug: "team",
  settings,
};
const booking: BookingRow = {
  id: randomUUID(),
  link_id: link.id,
  account_id: link.account_id,
  settings,
  name: "Guest <script>",
  email: "guest@example.test",
  phone: "123",
  message: "Hello\n<script>alert(1)</script>",
  starts_at: new Date(Date.now() + 86400000),
  ends_at: new Date(Date.now() + 88200000),
  status: "pending",
  hold_until: new Date(Date.now() + 3600000),
  event_id: null,
  meeting_url: null,
  payload_hash: "hash",
};
test("approval tokens reject tampering, expired claims and extra token segments", () => {
  const claims = {
    id: booking.id,
    accountId: booking.account_id,
    userId: "owner",
    exp: Date.now() + 60000,
  };
  const token = createBookingDecisionToken(claims);
  assert.deepEqual(verifyBookingDecisionToken(token), claims);
  assert.equal(verifyBookingDecisionToken(token + ".extra"), null);
  assert.equal(verifyBookingDecisionToken(token.slice(0, -5) + "aaaaa"), null);
  assert.equal(verifyBookingDecisionToken(token, claims.exp), null);
  assert.equal(verifyBookingDecisionToken("x".repeat(2001)), null);
});
test("organizer email has escaped details and private approval buttons; guests never receive approval authority", () => {
  const owner = bookingNotice(
    link,
    booking,
    "pending",
    "owner@example.test",
    true,
  );
  const guest = bookingNotice(
    link,
    booking,
    "pending",
    "owner@example.test",
    false,
  );
  assert.match(owner.html, /Approve booking/);
  assert.match(owner.html, /Decline booking/);
  assert.match(owner.html, /&lt;script&gt;/);
  assert.doesNotMatch(owner.html, /<script>/);
  assert.match(owner.html, /role="presentation"/);
  assert.match(owner.text, /Phone: 123\n\nMessage:/);
  assert.doesNotMatch(owner.text, /settings\?tab=/);
  assert.doesNotMatch(guest.html, /booking\/decision|token=|Approve booking/);
  assert.match(guest.text, /not confirmed yet/);
  const match = owner.text.match(/#token=([^&\s]+)/)!;
  assert.equal(
    verifyBookingDecisionToken(decodeURIComponent(match[1]!))?.id,
    booking.id,
  );
});
test("confirmed notifications include meeting and calendar links, with no approval buttons", () => {
  const notice = bookingNotice(
    link,
    {
      ...booking,
      status: "confirmed",
      meeting_url: "https://example.test/room",
    },
    "confirmed",
    "owner@example.test",
    true,
  );
  assert.match(notice.html, /Join meeting/);
  assert.match(notice.html, /Open calendar/);
  assert.doesNotMatch(notice.html, /Approve booking|booking\/decision/);
  const expired = bookingNotice(
    link,
    { ...booking, hold_until: new Date(0) },
    "pending",
    "owner@example.test",
    true,
  );
  assert.doesNotMatch(expired.html, /Approve booking|booking\/decision/);
});

test("email scanner GETs cannot decide a booking and invalid POST tokens fail before database access", async () => {
  const { default: Fastify } = await import("fastify");
  const { publicEventLinks } = await import("../routes/eventLinks.js");
  const app = Fastify();
  app.setErrorHandler((error, _req, reply) =>
    reply
      .code((error as { status?: number }).status ?? 500)
      .send({ error: error.message }),
  );
  await app.register(publicEventLinks);
  try {
    assert.equal(
      (
        await app.inject({
          method: "GET",
          url: "/product/event-links/decision?token=invalid&decision=approve",
        })
      ).statusCode,
      404,
    );
    for (const path of ["decision-preview", "decision"]) {
      const response = await app.inject({
        method: "POST",
        url: `/product/event-links/${path}`,
        payload: { token: "invalid", decision: "approve" },
      });
      assert.equal(response.statusCode, 403);
      assert.match(response.json().error, /invalid or expired/);
    }
  } finally {
    await app.close();
  }
});
