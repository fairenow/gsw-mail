import { strict as assert } from "node:assert";
import { test } from "node:test";
import { DemoEngine } from "./demo.js";

test("demo engine serves the standard mailbox set", async () => {
  const engine = new DemoEngine();
  const roles = (await engine.listMailboxes("account-a")).map((m) => m.role);
  assert.deepEqual(roles.sort(), ["archive", "drafts", "inbox", "sent", "spam", "trash"]);
});

test("demo engine seeds per-account inbox sample messages", async () => {
  const engine = new DemoEngine();
  const inbox = await engine.listMessages("account-a", { mailbox: "Inbox" });
  assert.ok(inbox.length >= 3);
});

test("saveDraft places a retrievable draft in Drafts", async () => {
  const engine = new DemoEngine();
  const id = await engine.saveDraft("account-a", {
    from: "a@example.com",
    to: ["b@example.com"],
    subject: "Draft subject",
    textBody: "Draft body",
  });
  const draft = await engine.getMessage("account-a", id);
  assert.ok(draft);
  assert.equal(draft.mailbox, "Drafts");
  assert.equal(draft.subject, "Draft subject");
});

test("updateDraft keeps one draft and preserves reply headers", async () => {
  const engine = new DemoEngine();
  const id = await engine.saveDraft("account-a", { from: "a@example.com", to: [], subject: "Draft", textBody: "one" });
  await engine.updateDraft("account-a", id, {
    from: "a@example.com",
    to: ["b@example.com"],
    subject: "Re: Draft",
    textBody: "two",
    inReplyTo: "<original@example.com>",
    references: "<original@example.com>",
  });
  const draft = await engine.getMessage("account-a", id);
  assert.equal(draft?.subject, "Re: Draft");
  assert.equal(draft?.textBody, "two");
  assert.equal(draft?.headers["In-Reply-To"], "<original@example.com>");
  assert.equal(draft?.headers.References, "<original@example.com>");
  assert.equal((await engine.listMessages("account-a", { mailbox: "Drafts" })).filter((message) => message.engineId === id).length, 1);
});

test("saveSent preserves the RFC Message-ID and findMessageByRfcMessageId round-trips", async () => {
  const engine = new DemoEngine();
  const messageId = "<00000000-0000-4000-8000-0000000000aa@mail.guidedstepswellness.com>";
  const sent = await engine.saveSent("account-a", {
    from: "a@example.com",
    to: ["b@example.com"],
    subject: "Hello",
    textBody: "Hi",
    messageId,
    inReplyTo: "<prev@example.com>",
  });
  assert.equal(sent.engineMessageId, sent.engineMessageId);
  const found = await engine.findMessageByRfcMessageId("account-a", messageId);
  assert.ok(found);
  assert.equal(found.engineMessageId, sent.engineMessageId);
  assert.equal(found.engineThreadId, sent.threadId);
  const full = await engine.getMessage("account-a", sent.engineMessageId);
  assert.ok(full);
  assert.equal(full.headers["Message-ID"], messageId);
  assert.equal(full.headers["In-Reply-To"], "<prev@example.com>");
});

test("findMessageByRfcMessageId is per-account", async () => {
  const engine = new DemoEngine();
  const messageId = "<00000000-0000-4000-8000-0000000000bb@mail.guidedstepswellness.com>";
  await engine.saveSent("account-a", { from: "a@example.com", to: ["b@example.com"], messageId });
  const other = await engine.findMessageByRfcMessageId("account-other", messageId);
  assert.equal(other, null);
});

test("move relocates a message (undo-style Sent -> Drafts)", async () => {
  const engine = new DemoEngine();
  const sent = await engine.saveSent("account-a", {
    from: "a@example.com",
    to: ["b@example.com"],
    subject: "To undo",
  });
  await engine.move("account-a", [sent.engineMessageId], "Drafts");
  const message = await engine.getMessage("account-a", sent.engineMessageId);
  assert.ok(message);
  assert.equal(message.mailbox, "Drafts");
});

test("search matches sender, subject, and body", async () => {
  const engine = new DemoEngine();
  await engine.saveSent("account-a", {
    from: "alice@example.com",
    to: ["b@example.com"],
    subject: "Quarterly report",
    textBody: "Attached the numbers.",
  });
  const byBody = await engine.search("account-a", "numbers");
  assert.ok(byBody.some((m) => m.subject === "Quarterly report"));
});
