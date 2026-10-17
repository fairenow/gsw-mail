import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { decodeMcpPayloadKey, decryptMcpPayload, encryptMcpPayload } from "./encryptedPayload.js";

const approvalId = "a0000000-0000-4000-8000-000000000001";
const digest = "a".repeat(64);
const argumentsValue = { to: ["person@example.com"], subject: "Private subject", textBody: "Sensitive email body" };

test("encrypted payload round trips without exposing plaintext", () => {
  const key = randomBytes(32);
  const payload = encryptMcpPayload({ approvalId, argumentsDigest: digest, argumentsValue, key });
  assert.equal(payload.version, 1);
  assert.ok(!JSON.stringify(payload).includes("Sensitive email body"));
  assert.deepEqual(decryptMcpPayload({ approvalId, argumentsDigest: digest, payload, key }), argumentsValue);
});

test("payload cannot be reused with another approval, digest or key", () => {
  const key = randomBytes(32);
  const payload = encryptMcpPayload({ approvalId, argumentsDigest: digest, argumentsValue, key });
  for (const change of [
    { approvalId: "b0000000-0000-4000-8000-000000000001", argumentsDigest: digest, key },
    { approvalId, argumentsDigest: "b".repeat(64), key },
    { approvalId, argumentsDigest: digest, key: randomBytes(32) },
  ]) {
    assert.throws(() => decryptMcpPayload({ ...change, payload }));
  }
});

test("tampering and unsupported versions fail closed", () => {
  const key = randomBytes(32);
  const payload = encryptMcpPayload({ approvalId, argumentsDigest: digest, argumentsValue, key });
  assert.throws(() => decryptMcpPayload({ approvalId, argumentsDigest: digest, payload: { ...payload, authTag: Buffer.alloc(16).toString("base64") }, key }));
  assert.throws(() => decryptMcpPayload({ approvalId, argumentsDigest: digest, payload: { ...payload, version: 2 }, key }));
});

test("requires a valid, stable 32-byte base64 encryption key", () => {
  const key = randomBytes(32);
  assert.deepEqual(decodeMcpPayloadKey(key.toString("base64")), key);
  for (const value of [undefined, "", "development-secret", Buffer.alloc(16).toString("base64")]) {
    assert.throws(() => decodeMcpPayloadKey(value));
  }
});

test("rejects payloads larger than one megabyte", () => {
  assert.throws(() => encryptMcpPayload({ approvalId, argumentsDigest: digest, argumentsValue: { textBody: "x".repeat(1024 * 1024) }, key: randomBytes(32) }));
});
