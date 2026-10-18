import assert from "node:assert/strict";
import test from "node:test";
import { requiresExplicitActionConfirmation } from "./actionConfirmationPolicy.js";

test("external actions require confirmation across transports", () => {
  assert.equal(requiresExplicitActionConfirmation("external", []), true);
  assert.equal(requiresExplicitActionConfirmation("external", ["mail.send"]), true);
});

test("always-confirm scopes keep confirmation even with nonexternal risk", () => {
  assert.equal(requiresExplicitActionConfirmation("reversible_write", ["browser.write"]), true);
  assert.equal(requiresExplicitActionConfirmation("reversible_write", ["mail.send"]), true);
});

test("read and ordinary reversible writes preserve existing confirmation behavior", () => {
  assert.equal(requiresExplicitActionConfirmation("read", ["mail.read"]), false);
  assert.equal(requiresExplicitActionConfirmation("reversible_write", ["mail.write"]), false);
  assert.equal(requiresExplicitActionConfirmation("reversible_write", ["contacts.write"]), false);
});
