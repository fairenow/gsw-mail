import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

test("Stripe checkout is disabled by default unless explicitly enabled", async () => {
  const { stripeBillingConfig, configuredStripeValue, isStripeLiveReady } = await import("./stripeService.js");
  assert.equal(configuredStripeValue("REPLACE_WITH_STRIPE_LIVE_SECRET_KEY"),false);
  assert.equal(configuredStripeValue(""),false);
  assert.equal(configuredStripeValue("price_123"),true);
  assert.equal(stripeBillingConfig.checkoutEnabled,process.env.STRIPE_CHECKOUT_ENABLED==="true");
  if(!process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY.startsWith("REPLACE_WITH_"))assert.equal(isStripeLiveReady(),false);
});

test("Stripe webhook rejects missing or incorrectly signed data", async () => {
  const old=process.env.STRIPE_WEBHOOK_SECRET;
  process.env.STRIPE_WEBHOOK_SECRET="whsec_gsw_test_signature_key";
  try {
    const url = new URL("./stripeService.js?signature-test", import.meta.url);
    const {verifyStripeSignature}=await import(url.href);
    const payload=Buffer.from('{"id":"evt_gsw_test","type":"customer.subscription.updated"}');
    const ts=1800000000;
    const sig=createHmac("sha256",process.env.STRIPE_WEBHOOK_SECRET).update(String(ts)+".").update(payload).digest("hex");
    assert.doesNotThrow(()=>verifyStripeSignature(payload,"t="+ts+",v1="+sig,ts));
    assert.throws(()=>verifyStripeSignature(payload,"t="+ts+",v1="+"0".repeat(64),ts));
    assert.throws(()=>verifyStripeSignature(payload,"t="+(ts-301)+",v1="+sig,ts));
    assert.throws(()=>verifyStripeSignature(Buffer.concat([payload,Buffer.from("x")]),"t="+ts+",v1="+sig,ts));
    assert.throws(()=>verifyStripeSignature(payload,undefined,ts));
  } finally {
    if(old===undefined)delete process.env.STRIPE_WEBHOOK_SECRET;else process.env.STRIPE_WEBHOOK_SECRET=old;
  }
});
