import assert from "node:assert/strict";
import test from "node:test";
import { resolveMailboxCredential } from "./resolveMailboxCredential.js";

test("verified persisted credential avoids browser OAuth even after a cold start", async () => {
  const token = await resolveMailboxCredential({
    stored: async () => "verified",
    refresh: async () => assert.fail("refresh must not run"),
    interactive: async () => assert.fail("public authorize must not run"),
    report: () => {},
  });
  assert.equal(token, "verified");
});

test("expired or unverifiable access credential uses independent verified refresh", async () => {
  for (const stored of [async () => null, async () => { throw new Error("invalid signature"); }]) {
    const token = await resolveMailboxCredential({
      stored,
      refresh: async () => "verified refreshed",
      interactive: async () => assert.fail("interactive must not run"),
      report: () => {},
    });
    assert.equal(token, "verified refreshed");
  }
});

test("missing persisted grants preserves interactive session requirement and propagates failure", async () => {
  const denied = new Error("mailbox_session_required");
  await assert.rejects(resolveMailboxCredential({
    stored: async () => null,
    refresh: async () => { throw new Error("revoked"); },
    interactive: async () => { throw denied; },
    report: () => {},
  }), error => error === denied);
});
