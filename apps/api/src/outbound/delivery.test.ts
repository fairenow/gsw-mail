import { strict as assert } from "node:assert";
import { test } from "node:test";
import { deriveDeliveryStatus } from "./delivery.js";

test("deriveDeliveryStatus handles every meaningful recipient set", () => {
  assert.equal(deriveDeliveryStatus([]), "pending");
  assert.equal(deriveDeliveryStatus(["pending"]), "pending");
  assert.equal(deriveDeliveryStatus(["delivered", "pending"]), "pending");
  assert.equal(deriveDeliveryStatus(["delivered", "delivered"]), "delivered");
  assert.equal(deriveDeliveryStatus(["delivered"]), "delivered");
  assert.equal(deriveDeliveryStatus(["deferred"]), "deferred");
  assert.equal(deriveDeliveryStatus(["deferred", "delivered"]), "deferred");
  assert.equal(deriveDeliveryStatus(["bounced"]), "bounced");
  assert.equal(deriveDeliveryStatus(["bounced", "complained"]), "bounced");
  assert.equal(deriveDeliveryStatus(["complained"]), "complained");
  assert.equal(deriveDeliveryStatus(["delivered", "bounced"]), "partial_failure");
  assert.equal(deriveDeliveryStatus(["delivered", "complained"]), "partial_failure");
  assert.equal(deriveDeliveryStatus(["delivered", "bounced", "complained"]), "partial_failure");
  assert.equal(deriveDeliveryStatus(["delivered", "pending", "bounced"]), "partial_failure");
});

test("deriveDeliveryStatus treats unknown statuses as pending", () => {
  const any = ["delivered", "delivered", "mystery" as const] as Array<
    "pending" | "delivered" | "deferred" | "bounced" | "complained"
  >;
  assert.equal(deriveDeliveryStatus(any), "pending");
});