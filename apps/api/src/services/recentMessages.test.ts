import assert from "node:assert/strict";
import test from "node:test";
import { pageRecentMessages } from "./recentMessages.js";

const items = Array.from({ length: 12 }, (_, i) => ({ id: i, read: i % 3 !== 0 }));

test("lists newest messages and continues without duplicates", async () => {
  const list = async (offset: number, limit: number) => items.slice(offset, offset + limit);
  const first = await pageRecentMessages(list, { limit: 5 });
  assert.deepEqual(first.messages.map(x => x.id), [0, 1, 2, 3, 4]);
  assert.equal(first.nextCursor, "5");
  const second = await pageRecentMessages(list, { limit: 5, cursor: first.nextCursor! });
  assert.deepEqual(second.messages.map(x => x.id), [5, 6, 7, 8, 9]);
});

test("unread filtering advances cursor by scanned messages, not matches", async () => {
  const list = async (offset: number, limit: number) => items.slice(offset, offset + limit);
  const first = await pageRecentMessages(list, { limit: 2, unreadOnly: true });
  assert.deepEqual(first.messages.map(x => x.id), [0, 3]);
  assert.equal(first.nextCursor, "4");
  const second = await pageRecentMessages(list, { limit: 2, unreadOnly: true, cursor: first.nextCursor! });
  assert.deepEqual(second.messages.map(x => x.id), [6, 9]);
  const last = await pageRecentMessages(list, { limit: 2, unreadOnly: true, cursor: second.nextCursor! });
  assert.deepEqual(last.messages, []);
  assert.equal(last.complete, true);
  assert.equal(last.nextCursor, null);
});

test("empty folder is complete, not an error", async () => {
  const result = await pageRecentMessages(async () => [], { limit: 5 });
  assert.deepEqual(result.messages, []);
  assert.equal(result.complete, true);
  assert.equal(result.nextCursor, null);
});

test("rejects invalid limits and cursors", async () => {
  const list = async () => items;
  await assert.rejects(pageRecentMessages(list, { limit: 51 }), /limit/);
  await assert.rejects(pageRecentMessages(list, { limit: 5, cursor: "-1" }), /cursor/);
  await assert.rejects(pageRecentMessages(list, { limit: 5, cursor: "abc" }), /cursor/);
});

test("propagates backend failures rather than returning empty results", async () => {
  await assert.rejects(pageRecentMessages(async () => { throw new Error("JMAP unavailable"); }, { limit: 5 }), /JMAP unavailable/);
});
