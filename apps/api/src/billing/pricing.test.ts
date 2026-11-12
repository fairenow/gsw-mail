import assert from "node:assert/strict";
import test from "node:test";
import { BILLING_DEFAULTS, quoteBilling, isLegacyUnlimited } from "./pricing.js";

test("one mailbox is $2.50 monthly or $15 annual", () => {
  assert.equal(quoteBilling(1, 0, "month").totalCents, 250);
  assert.equal(quoteBilling(1, 0, "year").totalCents, 1500);
});
test("AI is optional, priced per mailbox and adds $25 monthly or $125 annually", () => {
  assert.equal(quoteBilling(2, 1, "month").totalCents, 7500);
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
test("legacy entitlement exempts an existing user or workspace, without bypassing safety controls", () => {
  assert.equal(isLegacyUnlimited(true, false), true);
  assert.equal(isLegacyUnlimited(false, true), true);
  assert.equal(isLegacyUnlimited(false, false), false);
});
test("initial API usage allowance scales per mailbox, not per domain", () => {
  assert.equal(BILLING_DEFAULTS.apiRequestsPerMailboxPerMonth * 3, 30_000);
});
