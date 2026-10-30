import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from "node:crypto";

export type CredentialBinding = { accountId: string; authUserId: string; clientId: string };
export const oauthTokenHash = (token: string) => createHash("sha256").update(token).digest("base64url");
const aad = (binding: CredentialBinding) => Buffer.from(JSON.stringify([1, binding.accountId, binding.authUserId, binding.clientId]));
const key = (secret: string) => {
  if (secret.length < 32 || secret.includes("development-only")) throw new Error("mailbox credential encryption is not configured");
  return Buffer.from(hkdfSync("sha256", secret, "gsw-mailbox-credentials-v1", "aes-256-gcm", 32));
};
export function encryptMailboxCredential(value: string, binding: CredentialBinding, secret: string): string {
  if (!value || value.length > 16384) throw new Error("invalid mailbox credential");
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(secret), nonce);
  cipher.setAAD(aad(binding));
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return ["v1", nonce.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}
export function decryptMailboxCredential(value: string, binding: CredentialBinding, secret: string): string {
  const [version, nonce, tag, encrypted, extra] = value.split(".");
  if (version !== "v1" || !nonce || !tag || !encrypted || extra || value.length > 24000) throw new Error("invalid encrypted mailbox credential");
  const decipher = createDecipheriv("aes-256-gcm", key(secret), Buffer.from(nonce, "base64url"));
  decipher.setAAD(aad(binding));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
}
