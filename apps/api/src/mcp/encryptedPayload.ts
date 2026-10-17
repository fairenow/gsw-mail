import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Encrypt proposed MCP tool arguments at rest. No plaintext, keys or
 * message bodies should be written to approval ledger or logs.
 *
 * The caller must use a stable per-environment 32-byte key, base64-encoded
 * as MCP_APPROVAL_PAYLOAD_KEY. There is deliberately no development fallback.
 */
const MAX_PLAINTEXT_BYTES = 1024 * 1024;
const VERSION = 1;

export interface EncryptedMcpPayload {
  version: number;
  nonce: string;
  ciphertext: string;
  authTag: string;
}

export function decodeMcpPayloadKey(encoded: string | undefined): Buffer {
  if (!encoded || !/^(?:[A-Za-z0-9+/]{4}){10}[A-Za-z0-9+/]{2}==$/.test(encoded)) {
    throw new Error("MCP approval payload encryption key is missing or malformed");
  }
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32 || key.toString("base64") !== encoded) {
    throw new Error("MCP approval payload encryption key must be 32 bytes");
  }
  return key;
}

function aadFor(approvalId: string, argumentsDigest: string): Buffer {
  if (!/^[0-9a-f]{64}$/.test(argumentsDigest) || !/^[0-9a-f-]{36}$/i.test(approvalId)) {
    throw new Error("Invalid MCP approval payload binding");
  }
  return Buffer.from(JSON.stringify([VERSION, approvalId, argumentsDigest]), "utf8");
}

export function encryptMcpPayload(input: {
  approvalId: string;
  argumentsDigest: string;
  argumentsValue: unknown;
  key: Buffer;
}): EncryptedMcpPayload {
  if (input.key.length !== 32) throw new Error("Invalid MCP encryption key length");
  const serialized = JSON.stringify(input.argumentsValue);
  if (typeof serialized !== "string") throw new Error("Invalid MCP payload arguments");
  const plain = Buffer.from(serialized, "utf8");
  if (plain.length === 0 || plain.length > MAX_PLAINTEXT_BYTES) {
    throw new Error("MCP approval payload exceeds size limit");
  }
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", input.key, nonce);
  cipher.setAAD(aadFor(input.approvalId, input.argumentsDigest));
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
  return {
    version: VERSION,
    nonce: nonce.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptMcpPayload(input: {
  approvalId: string;
  argumentsDigest: string;
  payload: EncryptedMcpPayload;
  key: Buffer;
}): unknown {
  if (input.key.length !== 32 || input.payload.version !== VERSION) {
    throw new Error("Unsupported MCP payload encryption parameters");
  }
  const nonce = Buffer.from(input.payload.nonce, "base64");
  const tag = Buffer.from(input.payload.authTag, "base64");
  const ciphertext = Buffer.from(input.payload.ciphertext, "base64");
  if (nonce.length !== 12 || tag.length !== 16 || ciphertext.length > MAX_PLAINTEXT_BYTES + 32) {
    throw new Error("Invalid MCP encrypted payload");
  }
  const decipher = createDecipheriv("aes-256-gcm", input.key, nonce);
  decipher.setAAD(aadFor(input.approvalId, input.argumentsDigest));
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  if (plaintext.length > MAX_PLAINTEXT_BYTES) throw new Error("MCP payload exceeds size limit");
  return JSON.parse(plaintext.toString("utf8")) as unknown;
}
