import test from "node:test";
import assert from "node:assert/strict";
import { scopedMailEngine } from "./scoped.js";
import { DemoEngine } from "./demo.js";

test("concurrent mailbox operations retain their selected engine and arguments", async () => {
  const calls: unknown[] = [];
  const health = new DemoEngine();
  const engine = scopedMailEngine(async (id) => {
    await new Promise((resolve) => setTimeout(resolve, id === "alyssa" ? 10 : 0));
    const selected = new DemoEngine();
    selected.listMessages = async (requested, query) => { calls.push([id, requested, query]); return []; };
    selected.setSeen = async (requested, messages, seen) => { calls.push([id, requested, messages, seen]); };
    return selected;
  }, health);
  await Promise.all([engine.listMessages("alyssa", { mailbox: "Inbox" }), engine.listMessages("ramon", { mailbox: "Sent" }), engine.setSeen("alyssa", ["message-1"], true)]);
  assert.deepEqual(calls, [["ramon", "ramon", { mailbox: "Sent" }], ["alyssa", "alyssa", { mailbox: "Inbox" }], ["alyssa", "alyssa", ["message-1"], true]]);
});

test("failed account resolution never falls back to the health service mailbox", async () => {
  const health = new DemoEngine();
  health.listMessages = async () => { assert.fail("must not fall back to another mailbox"); };
  const engine = scopedMailEngine(async () => { throw new Error("mailbox unavailable"); }, health);
  await assert.rejects(engine.listMessages("missing", {}), /mailbox unavailable/);
});
