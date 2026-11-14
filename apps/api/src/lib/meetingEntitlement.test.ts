import assert from "node:assert/strict";
import test from "node:test";
import { hasPaidMeetingAccess } from "../meetings/entitlement.js";

test("meetings require a current paid Core subscription, independently of free mailbox access", () => {
  const now = Date.now();
  const paid = { status: "active", mailbox_quantity: 1, current_period_end: new Date(now + 60000) };
  assert.equal(hasPaidMeetingAccess(paid, now), true);
  assert.equal(hasPaidMeetingAccess(undefined, now), false);
  assert.equal(hasPaidMeetingAccess({ ...paid, mailbox_quantity: 0 }, now), false);
  assert.equal(hasPaidMeetingAccess({ ...paid, current_period_end: null }, now), false);
  assert.equal(hasPaidMeetingAccess({ ...paid, current_period_end: new Date(now - 1) }, now), false);
  for (const status of ["past_due", "canceled", "unpaid", "incomplete"])
    assert.equal(hasPaidMeetingAccess({ ...paid, status }, now), false);
});
