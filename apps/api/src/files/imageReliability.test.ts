import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyImageAttempt, imageAssetIsReady } from "./imageReliability.js";

test("authorization and invalid requests are permanent", () => {
  for(const status of [400,401,403,404,422]) assert.equal(classifyImageAttempt(status),"permanent");
});
test("classifies rate limits, timeouts and service failures", () => {
  assert.equal(classifyImageAttempt(429),"rate_limit");
  assert.equal(classifyImageAttempt(504),"timeout");
  assert.equal(classifyImageAttempt(502),"provider_error");
});
test("persistence requires ready, user-owned, matching image", () => {
  const expected={userId:"user-a",mimeType:"image/png",sizeBytes:400};
  const valid={status:"ready",userId:"user-a",mimeType:"image/png",sizeBytes:"400"};
  assert.equal(imageAssetIsReady(valid,expected),true);
  assert.equal(imageAssetIsReady({...valid,status:"upload_pending"},expected),false);
  assert.equal(imageAssetIsReady({...valid,userId:"user-b"},expected),false);
  assert.equal(imageAssetIsReady({...valid,mimeType:"text/plain"},expected),false);
  assert.equal(imageAssetIsReady({...valid,sizeBytes:"399"},expected),false);
});
