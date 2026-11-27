import assert from "node:assert/strict";
import test from "node:test";
import type { FullMessage, MailEngine } from "../engine/types.js";
import { markSenderNotSpam } from "./markSenderNotSpam.js";

function fixture(mailbox = "Junk", sender: string | null = " Sender@Example.org ") {
  const operations: string[] = [];
  const engine: Pick<MailEngine, "getMessage" | "listMailboxes" | "move"> = {
    async getMessage(account, id) {
      assert.equal(account, "mailbox-a");
      assert.equal(id, "message-a");
      return { mailbox, ...(sender ? { from: { email: sender } } : {}) } as FullMessage;
    },
    async listMailboxes() { return [{ role: "spam", engineName: "Junk", engineId: "junk-id" }]; },
    async move(account, ids, destination) { operations.push(`move:${account}:${ids.join(",")}:${destination}`); },
  };
  return { engine, operations, trust: async (email: string) => { operations.push(`trust:${email}`); } };
}

test("not spam trusts the exact normalized sender for the mailbox before moving the message", async () => {
  const { engine, operations, trust } = fixture();
  assert.equal(await markSenderNotSpam(engine, "mailbox-a", "message-a", trust), "sender@example.org");
  assert.deepEqual(operations, ["trust:sender@example.org", "move:mailbox-a:message-a:Inbox"]);
});
test("restoring Trash is not a trust action", async () => {
  const { engine, operations, trust } = fixture("Trash");
  await assert.rejects(markSenderNotSpam(engine, "mailbox-a", "message-a", trust), /Only messages in Spam/);
  assert.deepEqual(operations, []);
});
test("missing sender restores only the message", async () => {
  const { engine, operations, trust } = fixture("Junk", null);
  assert.equal(await markSenderNotSpam(engine, "mailbox-a", "message-a", trust), null);
  assert.deepEqual(operations, ["move:mailbox-a:message-a:Inbox"]);
});
test("a failed trust write does not report success or move the message", async () => {
  const { engine, operations } = fixture();
  await assert.rejects(markSenderNotSpam(engine, "mailbox-a", "message-a", async () => { throw new Error("trust unavailable"); }), /trust unavailable/);
  assert.deepEqual(operations, []);
});
