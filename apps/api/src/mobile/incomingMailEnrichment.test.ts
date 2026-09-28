import { strict as assert } from "node:assert";
import { test } from "node:test";
import { pickBestIncomingMessage } from "./incomingMailEnrichment.js";

test("matches the distinct JMAP email by sender and closest received time", () => {
  const eventAt = new Date("2026-09-28T13:00:00.000Z");
  const selected = pickBestIncomingMessage([
    {
      id: "email-a",
      receivedAt: "2026-09-28T12:59:58.000Z",
      subject: "First subject",
      preview: "First preview",
      from: [{ email: "other@example.com", name: "Other Sender" }],
    },
    {
      id: "email-b",
      receivedAt: "2026-09-28T12:59:55.000Z",
      subject: "Correct subject",
      preview: "Correct preview",
      from: [{ email: "ramon@example.com", name: "Ramon Williams" }],
    },
    {
      id: "email-c",
      receivedAt: "2026-09-28T12:40:00.000Z",
      subject: "Older subject",
      preview: "Older preview",
      from: [{ email: "ramon@example.com", name: "Ramon Williams" }],
    },
  ], "ramon@example.com", eventAt);

  assert.equal(selected?.id, "email-b");
  assert.equal(selected?.subject, "Correct subject");
});

test("does not match a different sender when the webhook supplies sender identity", () => {
  const selected = pickBestIncomingMessage([
    {
      id: "wrong",
      receivedAt: "2026-09-28T13:00:00.000Z",
      from: [{ email: "wrong@example.com" }],
    },
  ], "expected@example.com", new Date("2026-09-28T13:00:00.000Z"));

  assert.equal(selected, null);
});
