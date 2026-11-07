import assert from "node:assert/strict";
import test from "node:test";
import { bounceRecipientsFromEvent, classifyStalwartDeliveryEvent, isStalwartOutboundDeliveryEvent } from "./stalwartDelivery.js";

test("classifies final Stalwart delivery outcomes", () => {
  assert.equal(classifyStalwartDeliveryEvent("delivery.delivered"), "delivered");
  assert.equal(classifyStalwartDeliveryEvent("delivery.rcpt-to-rejected"), "bounced");
  assert.equal(classifyStalwartDeliveryEvent("delivery.message-rejected"), "bounced");
  assert.equal(classifyStalwartDeliveryEvent("delivery.null-mx"), "bounced");
  assert.equal(classifyStalwartDeliveryEvent("delivery.dsn-perm-fail"), "bounced");
  assert.equal(classifyStalwartDeliveryEvent("delivery.completed"), "completed");
});

test("classifies retryable delivery outcomes as deferred", () => {
  assert.equal(classifyStalwartDeliveryEvent("delivery.failed"), "deferred");
  assert.equal(classifyStalwartDeliveryEvent("delivery.rcpt-to-failed"), "deferred");
  assert.equal(classifyStalwartDeliveryEvent("delivery.dsn-temp-fail"), "deferred");
});

test("tracks queue correlation events but ignores unrelated telemetry", () => {
  assert.equal(classifyStalwartDeliveryEvent("queue.authenticated-message-queued"), "queued");
  assert.equal(isStalwartOutboundDeliveryEvent("queue.authenticated-message-queued"), true);
  assert.equal(isStalwartOutboundDeliveryEvent("message-ingest.ham"), false);
  assert.equal(classifyStalwartDeliveryEvent("delivery.start-tls"), null);
});

test("only suppresses the explicitly rejected recipient from a mixed To/CC envelope", () => {
  const event = {
    to: ["ramon@aistandard.app", "info@presidentcontainer.com"],
    details: "permanent failure for one or more recipients (info@presidentcontainer.com:blocked)",
  };
  assert.deepEqual(bounceRecipientsFromEvent(event), ["info@presidentcontainer.com"]);
});

test("does not attribute ambiguous multi-recipient bounce to every addressee", () => {
  assert.deepEqual(bounceRecipientsFromEvent({
    to: ["customer@example.com", "cc@example.com"],
    details: "permanent failure for one or more recipients",
  }), []);
});

test("preserves single-recipient bounce attribution", () => {
  assert.deepEqual(bounceRecipientsFromEvent({ to: ["customer@example.com"] }), ["customer@example.com"]);
});
