import assert from "node:assert/strict";
import test from "node:test";
import { selectBrokerClient } from "./brokerClientConfig.js";

const base = { clientId: "internal-stalwart", clientSecret: "secret", redirectUri: "https://mail.example.test/internal/oauth/stalwart/callback", mobileClientId: "gsw-mail-mobile" };

test("persistent mailbox broker uses an independent confidential client", () => {
  assert.deepEqual(selectBrokerClient(base), { clientId: base.clientId, clientSecret: base.clientSecret, redirectUri: base.redirectUri });
  assert.equal(selectBrokerClient({ ...base, clientId: base.mobileClientId }), null);
});

test("persistent mailbox broker rejects missing or incomplete authorization config", () => {
  assert.equal(selectBrokerClient({ ...base, clientId: undefined }), null);
  assert.equal(selectBrokerClient({ ...base, clientSecret: undefined }), null);
  assert.equal(selectBrokerClient({ ...base, redirectUri: "" }), null);
});
