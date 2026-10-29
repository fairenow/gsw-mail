import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { signedAssetEdgeUrl } from "./edgeDelivery.js";

test("edge URLs bind the object, transform and bounded expiry with a stable short window", () => {
  const input = { key: "private/user/a b.png", baseUrl: "https://edge.example", secret: "test-key", now: 1_000_000, width: 128 };
  const url = new URL(signedAssetEdgeUrl(input)!);
  assert.equal(url.pathname, "/asset");
  assert.equal(url.searchParams.get("key"), input.key);
  assert.equal(url.searchParams.get("variant"), "128");
  const expires = url.searchParams.get("expires")!;
  const ttl = Number(expires) - input.now / 1000;
  assert.ok(ttl >= 600 && ttl <= 900);
  assert.equal(url.searchParams.get("signature"), createHmac("sha256", input.secret).update(JSON.stringify([input.key, "128", expires])).digest("hex"));
  assert.equal(signedAssetEdgeUrl({ ...input, now: input.now + 1000 }), url.toString());
  assert.equal(new URL(signedAssetEdgeUrl({ ...input, width: 9000 })!).searchParams.get("variant"), "original");
});
