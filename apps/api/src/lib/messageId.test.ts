import { strict as assert } from "node:assert";
import { test } from "node:test";
import { generateMessageId } from "./messageId.js";

test("generateMessageId yields a well-formed RFC Message-ID", () => {
  const id = generateMessageId();
  assert.match(id, /^<[0-9a-f-]{36}@mail\.guidedstepswellness\.com>$/);
});

test("generateMessageId supports a custom domain", () => {
  const id = generateMessageId("gs.example.com");
  assert.match(id, /^<[0-9a-f-]{36}@gs\.example\.com>$/);
});

test("generateMessageId is unique across calls", () => {
  const ids = new Set(Array.from({ length: 100 }, () => generateMessageId()));
  assert.equal(ids.size, 100);
});