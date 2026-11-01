import assert from "node:assert/strict";
import test from "node:test";
import { issueWebhookSecret, openWebhookSecret, sealWebhookSecret, webhookBody, webhookSignature, assertSafeWebhookUrl } from "../integrations/customerWebhooks.js";

test("customer webhook secrets are encrypted, endpoint-bound and sign exact payload bytes", () => {
  const endpointId = "11111111-1111-4111-8111-111111111111";
  const secret = issueWebhookSecret();
  assert.match(secret, /^gsw_whsec_[a-f0-9]{64}$/);
  const sealed = sealWebhookSecret(secret, endpointId);
  assert.ok(!sealed.includes(secret));
  assert.equal(openWebhookSecret(sealed, endpointId), secret);
  assert.throws(() => openWebhookSecret(sealed, "22222222-2222-4222-8222-222222222222"));

  const body = webhookBody({
    id: "33333333-3333-4333-8333-333333333333",
    type: "email.delivered",
    payload: { requestId: "req-1" },
    createdAt: new Date("2026-11-01T04:00:00.000Z"),
  });
  assert.equal(body, '{"id":"33333333-3333-4333-8333-333333333333","type":"email.delivered","createdAt":"2026-11-01T04:00:00.000Z","data":{"requestId":"req-1"}}');
  assert.equal(webhookSignature(secret, "1793505600", body), webhookSignature(secret, "1793505600", body));
  assert.notEqual(webhookSignature(secret, "1793505601", body), webhookSignature(secret, "1793505600", body));
});

test("customer webhook targets require public HTTPS destinations", async () => {
  await assert.rejects(assertSafeWebhookUrl("http://example.com/hook"), /invalid_webhook_url/);
  await assert.rejects(assertSafeWebhookUrl("https://localhost/hook"), /unsafe_webhook_url/);
  await assert.rejects(assertSafeWebhookUrl("https://127.0.0.1/hook"), /unsafe_webhook_url/);
  await assert.rejects(assertSafeWebhookUrl("https://10.0.0.2/hook"), /unsafe_webhook_url/);
  await assert.rejects(assertSafeWebhookUrl("https://[::1]/hook"), /unsafe_webhook_url/);
  await assert.rejects(assertSafeWebhookUrl("https://user:pass@example.com/hook"), /invalid_webhook_url/);
});
