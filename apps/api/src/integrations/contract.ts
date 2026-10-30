import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";

export const integrationScopes = ["connection.read", "email.send", "email.read"] as const;
const email = z.string().email().max(254).transform(v => v.toLowerCase());
const header = z.string().regex(/^[^\x00-\x1f\x7f]*$/);
export const integrationSendSchema = z.object({
  senderId: z.string().uuid(),
  to: z.array(email).min(1).max(10),
  subject: header.min(1).max(998),
  text: z.string().min(1).max(100_000),
  html: z.string().max(100_000).optional(),
  replyTo: email.optional(),
  metadata: z.record(z.string().max(64), z.string().max(256)).refine(v => Object.keys(v).length <= 10).default({}),
}).strict();
export type IntegrationSend = z.infer<typeof integrationSendSchema>;
export const idempotencySchema = z.string().min(1).max(200).regex(/^[A-Za-z0-9._:-]+$/);
export const installationSchema = z.object({
  organizationId: z.string().uuid(),
  accountId: z.string().uuid(),
  name: z.string().trim().min(1).max(100),
  testMode: z.boolean().default(true),
  allowedRecipients: z.array(email).min(1).max(100).transform(v => [...new Set(v)]),
  dailyLimit: z.number().int().min(1).max(1000).default(100),
}).strict();
export const keySchema = z.object({
  name: z.string().trim().min(1).max(100),
  scopes: z.array(z.enum(integrationScopes)).min(1).max(3).transform(v => [...new Set(v)]),
  expiresInDays: z.number().int().min(1).max(90).default(30),
}).strict();
export const hashKey = (value: string): string => createHash("sha256").update(value).digest("hex");
export function issueIntegrationKey() {
  const secret = `gsw_int_${randomBytes(32).toString("hex")}`;
  return { secret, keyHash: hashKey(secret), keyPrefix: secret.slice(0, 16) };
}
export function fingerprint(input: IntegrationSend): string {
  return hashKey(JSON.stringify({ ...input, metadata: Object.fromEntries(Object.entries(input.metadata).sort(([a], [b]) => a.localeCompare(b))) }));
}
export class IntegrationError extends Error {
  constructor(readonly status: number, readonly code: string, readonly retryable = false) { super(code); }
}
