import assert from "node:assert/strict";
import test from "node:test";
import { mailboxOperations } from "../integrations/operations.js";

test("external mailbox API retains broad product capability coverage", () => {
  const capabilities = mailboxOperations.capabilities();
  const names = new Set(capabilities.map(capability => capability.name));
  assert.ok(capabilities.length >= 100, `expected at least 100 mailbox API operations, found ${capabilities.length}`);

  for (const required of [
    "mail.list_recent",
    "mail.search",
    "mail.read",
    "mail.create_draft",
    "contacts.search",
    "contacts.create",
    "calendar.events.list",
    "calendar.events.create",
    "campaign.create",
    "campaign.report",
    "templates.list",
    "files.search",
    "files.read",
    "automations.create",
    "tasks.create",
    "search.workspace",
  ]) {
    assert.ok(names.has(required), `missing representative mailbox API capability: ${required}`);
  }

  assert.ok(![...names].some(name => /^(admin|domain|workspace|alias|mailbox_admin)\./.test(name)), "admin capabilities must remain excluded from mailbox API");
});
