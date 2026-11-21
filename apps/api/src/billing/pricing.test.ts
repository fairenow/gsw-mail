import assert from "node:assert/strict";
import test from "node:test";
import { BILLING_DEFAULTS, MAILBOX_STORAGE_BYTES, quoteBilling, isLegacyUnlimited, billableMailboxCount } from "./pricing.js";

test("standard accounts pay for their first mailbox and grandfathered partners include one", () => {
  assert.equal(quoteBilling(1, 0, "month").totalCents, 250);
  assert.equal(quoteBilling(1, 0, "year").totalCents, 1500);
  assert.equal(quoteBilling(2, 0, "month").totalCents, 500);
  assert.equal(quoteBilling(2, 0, "year").totalCents, 3000);
  assert.equal(quoteBilling(4, 0, "year").paidMailboxes, 4);
  assert.equal(quoteBilling(4, 0, "year", 1).paidMailboxes, 3);
  assert.equal(quoteBilling(4, 0, "year", 1).totalCents, 4500);
  assert.equal(billableMailboxCount(0), 0);
  assert.equal(billableMailboxCount(1), 1);
  assert.equal(billableMailboxCount(1, 1), 0);
});
test("AI is optional, priced per mailbox and adds $25 monthly or $125 annually", () => {
  assert.equal(quoteBilling(2, 1, "month").totalCents, 3000);
  assert.equal(quoteBilling(2, 2, "year").totalCents, 28000);
});
test("zero mailboxes and free domain administration never generate charges", () => {
  assert.equal(quoteBilling(0, 0, "month").totalCents, 0);
});
test("invalid AI license assignments and quantities are rejected", () => {
  assert.throws(() => quoteBilling(1, 2, "month"));
  assert.throws(() => quoteBilling(-1, 0, "year"));
  assert.throws(() => quoteBilling(1.5, 0, "month"));
});
test("historical cutoff flags do not grant unlimited new mailboxes", () => {
  assert.equal(isLegacyUnlimited(true, false), false);
  assert.equal(isLegacyUnlimited(false, true), false);
  assert.equal(isLegacyUnlimited(false, false), false);
  assert.equal(quoteBilling(10, 0, "year", 10).totalCents, 0);
});
test("initial API usage allowance scales per mailbox, not per domain", () => {
  assert.equal(BILLING_DEFAULTS.apiRequestsPerMailboxPerMonth * 3, 30_000);
});

test("each core mailbox includes 5 GB of storage", () => {
  assert.equal(MAILBOX_STORAGE_BYTES, 5_000_000_000);
  assert.equal(BILLING_DEFAULTS.mailboxStorageBytes, 5_000_000_000);
});

test("AI on the included free mailbox is billed separately", () => {
  assert.equal(quoteBilling(1, 1, "year", 1).totalCents, 12500);
  assert.equal(quoteBilling(1, 1, "year", 1).paidMailboxes, 0);
  assert.throws(() => billableMailboxCount(2, -1));
});
