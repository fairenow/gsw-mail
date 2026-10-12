import { test } from "node:test";
import { strict as assert } from "node:assert";
import { GSW_ADMIN_SENDER, validateTransactionalDelivery, type InternalDeliveryRequest } from "./internalDelivery.js";

const valid: InternalDeliveryRequest = {
  kind: "transactional",
  sender: GSW_ADMIN_SENDER,
  recipient: "test@example.com",
  subject: "Verify account",
  text: "Verification instructions.",
  html: "<p>Verification instructions.</p>",
};

test("internal delivery validates a complete transactional request", () => {
  assert.doesNotThrow(() => validateTransactionalDelivery(valid));
});
test("internal delivery rejects an unverified sender", () => {
  assert.throws(() => validateTransactionalDelivery({ ...valid, sender: "malicious@example.com" as typeof GSW_ADMIN_SENDER }), /administrator sender/);
});
test("internal delivery rejects missing bodies", () => {
  assert.throws(() => validateTransactionalDelivery({ ...valid, text: "" }), /text and HTML/);
});
test("internal delivery rejects malformed recipients", () => {
  assert.throws(() => validateTransactionalDelivery({ ...valid, recipient: "not-an-email" }), /recipient/);
});
