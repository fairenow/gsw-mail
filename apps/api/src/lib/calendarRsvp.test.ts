import assert from "node:assert/strict";
import test from "node:test";
import { createCalendarRsvpToken, verifyCalendarRsvpToken } from "./calendarRsvp.js";

test("calendar RSVP token round-trips and rejects tampering", () => {
  const expiresAt = new Date(Date.now() + 60_000);
  const token = createCalendarRsvpToken("11111111-1111-1111-1111-111111111111", expiresAt);
  const verified = verifyCalendarRsvpToken(token);
  assert.equal(verified?.id, "11111111-1111-1111-1111-111111111111");
  assert.equal(verified?.expiresAt.getTime(), expiresAt.getTime());

  const tampered = token.replace(/.$/, token.endsWith("a") ? "b" : "a");
  assert.equal(verifyCalendarRsvpToken(tampered), null);
});

test("calendar RSVP token rejects expired links", () => {
  const token = createCalendarRsvpToken("22222222-2222-2222-2222-222222222222", new Date(Date.now() - 1_000));
  assert.equal(verifyCalendarRsvpToken(token), null);
});
