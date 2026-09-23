import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import { extractEmailAddresses, verifyStalwartWebhookSignature } from "./stalwartWebhooks.js";

test("extractEmailAddresses handles strings, arrays, and nested values", () => {
  assert.deepEqual(
    extractEmailAddresses([
      "Ramon <ramon@team.guidedstepswellness.com>",
      { recipient: "other@example.org" },
      "RAMON@team.guidedstepswellness.com",
    ]),
    ["ramon@team.guidedstepswellness.com", "other@example.org"],
  );
});

test("verifyStalwartWebhookSignature accepts the signed raw body", () => {
  const raw = Buffer.from(JSON.stringify({ events: [{ id: "evt-1", type: "message-ingest.ham" }] }));
  const secret = "unit-test-stalwart-webhook-secret";
  const signature = createHmac("sha256", secret).update(raw).digest("base64");

  assert.equal(verifyStalwartWebhookSignature(raw, signature, secret), true);
  assert.equal(verifyStalwartWebhookSignature(raw, `sha256=${signature}`, secret), true);
  assert.equal(verifyStalwartWebhookSignature(Buffer.from("different"), signature, secret), false);
  assert.equal(verifyStalwartWebhookSignature(raw, undefined, secret), false);
});
