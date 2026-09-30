import { strict as assert } from "node:assert";
import { test } from "node:test";
import { formatMessageIdHeader, generateMessageId, normalizeMessageIdValue } from "./messageId.js";

test("generateMessageId yields a JMAP-safe bare Message-ID value", () => {
  const id = generateMessageId();
  assert.match(id, /^[0-9a-f-]{36}@mail\.guidedstepswellness\.com$/);
  assert.equal(id.includes("<"), false);
  assert.equal(id.includes(">"), false);
});

test("generateMessageId supports a custom domain", () => {
  const id = generateMessageId("gs.example.com");
  assert.match(id, /^[0-9a-f-]{36}@gs\.example\.com$/);
});

test("generateMessageId is unique across calls", () => {
  const ids = new Set(Array.from({ length: 100 }, () => generateMessageId()));
  assert.equal(ids.size, 100);
});

test("Message-ID normalization prevents double angle brackets", () => {
  assert.equal(normalizeMessageIdValue("abc@example.com"), "abc@example.com");
  assert.equal(normalizeMessageIdValue("<abc@example.com>"), "abc@example.com");
  assert.equal(normalizeMessageIdValue("<<abc@example.com>>"), "abc@example.com");
  assert.equal(formatMessageIdHeader("abc@example.com"), "<abc@example.com>");
  assert.equal(formatMessageIdHeader("<abc@example.com>"), "<abc@example.com>");
  assert.equal(formatMessageIdHeader("<<abc@example.com>>"), "<abc@example.com>");
});
