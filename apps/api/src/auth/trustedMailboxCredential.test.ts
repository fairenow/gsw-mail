import assert from "node:assert/strict";
import test from "node:test";
import { resolveTrustedMailboxCredential } from "./trustedMailboxCredential.js";

const principal = { productUserId: "product-a", authUserId: "auth-a", accountId: "mailbox-a" };

test("credential broker authorizes before requesting a mailbox-scoped token", async () => {
  const stages: string[] = [];
  const token = await resolveTrustedMailboxCredential(principal, "send", {
    authorize: async (p, permission) => {
      assert.deepEqual(p, principal);
      assert.equal(permission, "send");
      stages.push("authorized");
    },
    issue: async () => {
      stages.push("issued");
      return { token: "test-token", authUserId: "auth-a", accountId: "mailbox-a" };
    },
  });
  assert.equal(token, "test-token");
  assert.deepEqual(stages, ["authorized", "issued"]);
});

test("denied authorization never calls credential issuance", async () => {
  let issued = false;
  await assert.rejects(resolveTrustedMailboxCredential(principal, "read", {
    authorize: async () => { throw new Error("account_access_denied"); },
    issue: async () => { issued = true; return { token: "test", authUserId: "auth-a", accountId: "mailbox-a" }; },
  }), /account_access_denied/);
  assert.equal(issued, false);
});

test("rejects credentials associated with another mailbox or principal", async () => {
  for (const overrides of [{ authUserId: "auth-b" }, { accountId: "mailbox-b" }, { token: "" }]) {
    await assert.rejects(resolveTrustedMailboxCredential(principal, "read", {
      authorize: async () => {},
      issue: async () => ({ token: "test", authUserId: "auth-a", accountId: "mailbox-a", ...overrides }),
    }), /mailbox_credential_binding_mismatch/);
  }
});

test("rejects incomplete principal before consulting issuer", async () => {
  let invoked = false;
  await assert.rejects(resolveTrustedMailboxCredential({ ...principal, accountId: "" }, "read", {
    authorize: async () => { invoked = true; },
    issue: async () => { invoked = true; return { token: "test", authUserId: "auth-a", accountId: "mailbox-a" }; },
  }), /mailbox_identity_required/);
  assert.equal(invoked, false);
});
