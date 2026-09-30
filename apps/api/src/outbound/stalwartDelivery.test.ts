import assert from "node:assert/strict";
import test from "node:test";
import { classifyStalwartDeliveryEvent, isStalwartOutboundDeliveryEvent } from "./stalwartDelivery.js";

test("classifies final Stalwart delivery outcomes", () => {
  assert.equal(classifyStalwartDeliveryEvent("delivery.delivered"), "delivered");
  assert.equal(classifyStalwartDeliveryEvent("delivery.rcpt-to-rejected"), "bounced");
  assert.equal(classifyStalwartDeliveryEvent("delivery.message-rejected"), "bounced");
  assert.equal(classifyStalwartDeliveryEvent("delivery.null-mx"), "bounced");
  assert.equal(classifyStalwartDeliveryEvent("delivery.completed"), "completed");
});

test("classifies retryable delivery outcomes as deferred", () => {
  assert.equal(classifyStalwartDeliveryEvent("delivery.failed"), "deferred");
  assert.equal(classifyStalwartDeliveryEvent("delivery.rcpt-to-failed"), "deferred");
});

test("tracks queue correlation events but ignores unrelated telemetry", () => {
  assert.equal(classifyStalwartDeliveryEvent("queue.authenticated-message-queued"), "queued");
  assert.equal(isStalwartOutboundDeliveryEvent("queue.authenticated-message-queued"), true);
  assert.equal(isStalwartOutboundDeliveryEvent("message-ingest.ham"), false);
  assert.equal(classifyStalwartDeliveryEvent("delivery.start-tls"), null);
});
