import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { and, eq, inArray, lt, lte } from "drizzle-orm";
import { db } from "../db/client.js";
import { integrationInstallations, integrationWebhookDeliveries, integrationWebhookEndpoints, integrationWebhookEvents } from "../db/integrationSchema.js";
import { config } from "../config.js";
import { IntegrationError } from "./contract.js";

type Database = typeof db;

export const integrationWebhookEventTypes = [
  "email.accepted",
  "email.delivered",
  "email.deferred",
  "email.bounced",
  "email.complained",
  "operation.completed",
] as const;
export type IntegrationWebhookEventType = typeof integrationWebhookEventTypes[number];

const MAX_ATTEMPTS = 6;
const RETRY_MS = [30_000, 120_000, 600_000, 3_600_000, 21_600_000];
const secretKey = () => Buffer.from(hkdfSync("sha256", config.auth.secret, "gsw-integration-webhooks-v1", "aes-256-gcm", 32));

function aad(endpointId: string): Buffer { return Buffer.from(`gsw-webhook:${endpointId}`); }

export function issueWebhookSecret(): string {
  return `gsw_whsec_${randomBytes(32).toString("hex")}`;
}

export function sealWebhookSecret(secret: string, endpointId: string): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secretKey(), nonce);
  cipher.setAAD(aad(endpointId));
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return ["v1", nonce.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function openWebhookSecret(sealed: string, endpointId: string): string {
  const [version, nonce, tag, ciphertext, extra] = sealed.split(".");
  if (version !== "v1" || !nonce || !tag || !ciphertext || extra) throw new Error("invalid webhook secret");
  const decipher = createDecipheriv("aes-256-gcm", secretKey(), Buffer.from(nonce, "base64url"));
  decipher.setAAD(aad(endpointId));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
}

const isPrivateIp = (address: string): boolean => {
  if (address === "::1" || address === "::") return true;
  const normalized = address.toLowerCase();
  if (normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80:")) return true;
  if (normalized.startsWith("::ffff:")) return isPrivateIp(normalized.slice("::ffff:".length));
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some(Number.isNaN)) return false;
  const a = parts[0]!;
  const b = parts[1]!;
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
};

export async function assertSafeWebhookUrl(raw: string): Promise<string> {
  let url: URL;
  try { url = new URL(raw); } catch { throw new IntegrationError(400, "invalid_webhook_url"); }
  if (url.protocol !== "https:" || url.username || url.password || !url.hostname) throw new IntegrationError(400, "invalid_webhook_url");
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname.endsWith(".internal")) throw new IntegrationError(400, "unsafe_webhook_url");
  if (isIP(hostname)) {
    if (isPrivateIp(hostname)) throw new IntegrationError(400, "unsafe_webhook_url");
    return url.toString();
  }
  let addresses: { address: string }[];
  try { addresses = await lookup(hostname, { all: true }); } catch { throw new IntegrationError(400, "webhook_host_unresolvable"); }
  if (!addresses.length || addresses.some(result => isPrivateIp(result.address))) throw new IntegrationError(400, "unsafe_webhook_url");
  return url.toString();
}

export function webhookBody(event: { id: string; type: string; payload: Record<string, unknown>; createdAt: Date }): string {
  return JSON.stringify({ id: event.id, type: event.type, createdAt: event.createdAt.toISOString(), data: event.payload });
}

export function webhookSignature(secret: string, timestamp: string, body: string): string {
  return `v1=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
}

export async function enqueueIntegrationWebhookEvent(input: {
  installationId: string;
  type: IntegrationWebhookEventType;
  dedupeKey: string;
  payload: Record<string, unknown>;
} , source: Database = db): Promise<string> {
  const [installation] = await source.select({ id: integrationInstallations.id, active: integrationInstallations.active, deletedAt: integrationInstallations.deletedAt })
    .from(integrationInstallations).where(eq(integrationInstallations.id, input.installationId)).limit(1);
  if (!installation || !installation.active || installation.deletedAt) return "";

  let [event] = await source.insert(integrationWebhookEvents).values(input).onConflictDoNothing({
    target: [integrationWebhookEvents.installationId, integrationWebhookEvents.dedupeKey],
  }).returning();
  if (!event) {
    [event] = await source.select().from(integrationWebhookEvents).where(and(
      eq(integrationWebhookEvents.installationId, input.installationId),
      eq(integrationWebhookEvents.dedupeKey, input.dedupeKey),
    )).limit(1);
  }
  if (!event) throw new Error("webhook event persistence failed");
  const endpoints = await source.select().from(integrationWebhookEndpoints).where(and(
    eq(integrationWebhookEndpoints.installationId, input.installationId),
    eq(integrationWebhookEndpoints.active, true),
  ));
  const targets = endpoints.filter(endpoint => endpoint.events.includes(input.type));
  if (targets.length) {
    await source.insert(integrationWebhookDeliveries).values(targets.map(endpoint => ({ endpointId: endpoint.id, eventId: event!.id })))
      .onConflictDoNothing({ target: [integrationWebhookDeliveries.endpointId, integrationWebhookDeliveries.eventId] });
  }
  return event.id;
}

async function deliverOne(deliveryId: string): Promise<void> {
  const [row] = await db.select({ delivery: integrationWebhookDeliveries, endpoint: integrationWebhookEndpoints, event: integrationWebhookEvents, installation: integrationInstallations })
    .from(integrationWebhookDeliveries)
    .innerJoin(integrationWebhookEndpoints, eq(integrationWebhookDeliveries.endpointId, integrationWebhookEndpoints.id))
    .innerJoin(integrationWebhookEvents, eq(integrationWebhookDeliveries.eventId, integrationWebhookEvents.id))
    .innerJoin(integrationInstallations, eq(integrationWebhookEndpoints.installationId, integrationInstallations.id))
    .where(eq(integrationWebhookDeliveries.id, deliveryId)).limit(1);
  if (!row || !row.endpoint.active || row.installation.deletedAt) {
    if (row) await db.update(integrationWebhookDeliveries).set({ status: "cancelled", processingAt: null }).where(eq(integrationWebhookDeliveries.id, deliveryId));
    return;
  }
  if (!row.installation.active) {
    await db.update(integrationWebhookDeliveries).set({ status: "retrying", processingAt: null, nextAttemptAt: new Date(Date.now() + 60_000) }).where(eq(integrationWebhookDeliveries.id, deliveryId));
    return;
  }

  const attempt = row.delivery.attempts + 1;
  let responseStatus: number | null = null;
  let errorText = "";
  try {
    const url = await assertSafeWebhookUrl(row.endpoint.url);
    const secret = openWebhookSecret(row.endpoint.secretEncrypted, row.endpoint.id);
    const body = webhookBody(row.event);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const response = await fetch(url, {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
      headers: {
        "content-type": "application/json",
        "user-agent": "GSW-Mail-Webhooks/1.0",
        "x-gsw-webhook-id": row.event.id,
        "x-gsw-webhook-timestamp": timestamp,
        "x-gsw-webhook-signature": webhookSignature(secret, timestamp, body),
      },
      body,
    });
    responseStatus = response.status;
    if (response.status >= 200 && response.status < 300) {
      await db.transaction(async tx => {
        await tx.update(integrationWebhookDeliveries).set({ status: "delivered", attempts: attempt, processingAt: null, lastStatus: response.status, lastError: null, deliveredAt: new Date() }).where(eq(integrationWebhookDeliveries.id, deliveryId));
        await tx.update(integrationWebhookEndpoints).set({ failureCount: 0, lastSuccessAt: new Date() }).where(eq(integrationWebhookEndpoints.id, row.endpoint.id));
      });
      return;
    }
    errorText = `HTTP ${response.status}`;
  } catch (error) {
    errorText = error instanceof Error ? error.message.slice(0, 500) : "webhook delivery failed";
  }

  const failed = attempt >= MAX_ATTEMPTS;
  const delay = RETRY_MS[Math.min(attempt - 1, RETRY_MS.length - 1)] ?? RETRY_MS[RETRY_MS.length - 1]!;
  await db.transaction(async tx => {
    await tx.update(integrationWebhookDeliveries).set({
      status: failed ? "failed" : "retrying",
      attempts: attempt,
      processingAt: null,
      nextAttemptAt: new Date(Date.now() + delay),
      lastStatus: responseStatus,
      lastError: errorText,
    }).where(eq(integrationWebhookDeliveries.id, deliveryId));
    await tx.update(integrationWebhookEndpoints).set({
      failureCount: row.endpoint.failureCount + 1,
      lastFailureAt: new Date(),
    }).where(eq(integrationWebhookEndpoints.id, row.endpoint.id));
  });
}

export function startIntegrationWebhookWorker(onError: (error: unknown) => void): () => void {
  let stopped = false;
  let running = false;
  const run = async () => {
    if (stopped || running) return;
    running = true;
    try {
      await db.update(integrationWebhookDeliveries).set({ status: "retrying", processingAt: null, nextAttemptAt: new Date() }).where(and(
        eq(integrationWebhookDeliveries.status, "processing"),
        lt(integrationWebhookDeliveries.processingAt, new Date(Date.now() - 5 * 60_000)),
      ));
      const candidates = await db.select({ id: integrationWebhookDeliveries.id }).from(integrationWebhookDeliveries).where(and(
        inArray(integrationWebhookDeliveries.status, ["pending", "retrying"]),
        lte(integrationWebhookDeliveries.nextAttemptAt, new Date()),
      )).limit(20);
      for (const candidate of candidates) {
        const [claimed] = await db.update(integrationWebhookDeliveries).set({ status: "processing", processingAt: new Date() }).where(and(
          eq(integrationWebhookDeliveries.id, candidate.id),
          inArray(integrationWebhookDeliveries.status, ["pending", "retrying"]),
          lte(integrationWebhookDeliveries.nextAttemptAt, new Date()),
        )).returning({ id: integrationWebhookDeliveries.id });
        if (claimed) await deliverOne(claimed.id);
      }
    } catch (error) {
      onError(error);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => { void run(); }, 5_000);
  timer.unref();
  void run();
  return () => { stopped = true; clearInterval(timer); };
}

export async function createWebhookEndpoint(input: { installationId: string; url: string; events: IntegrationWebhookEventType[] }) {
  const id = randomUUID();
  const url = await assertSafeWebhookUrl(input.url);
  const secret = issueWebhookSecret();
  const [endpoint] = await db.insert(integrationWebhookEndpoints).values({
    id,
    installationId: input.installationId,
    url,
    secretEncrypted: sealWebhookSecret(secret, id),
    secretPrefix: secret.slice(0, 18),
    events: [...new Set(input.events)],
  }).returning({ id: integrationWebhookEndpoints.id, url: integrationWebhookEndpoints.url, events: integrationWebhookEndpoints.events, active: integrationWebhookEndpoints.active, secretPrefix: integrationWebhookEndpoints.secretPrefix, createdAt: integrationWebhookEndpoints.createdAt });
  return { endpoint: endpoint!, secret };
}

export async function listWebhookEndpoints(installationId: string) {
  return db.select({
    id: integrationWebhookEndpoints.id,
    url: integrationWebhookEndpoints.url,
    events: integrationWebhookEndpoints.events,
    active: integrationWebhookEndpoints.active,
    secretPrefix: integrationWebhookEndpoints.secretPrefix,
    failureCount: integrationWebhookEndpoints.failureCount,
    lastSuccessAt: integrationWebhookEndpoints.lastSuccessAt,
    lastFailureAt: integrationWebhookEndpoints.lastFailureAt,
    createdAt: integrationWebhookEndpoints.createdAt,
  }).from(integrationWebhookEndpoints).where(eq(integrationWebhookEndpoints.installationId, installationId));
}

export async function removeWebhookEndpoint(installationId: string, endpointId: string): Promise<boolean> {
  const [row] = await db.update(integrationWebhookEndpoints).set({ active: false }).where(and(
    eq(integrationWebhookEndpoints.id, endpointId),
    eq(integrationWebhookEndpoints.installationId, installationId),
  )).returning({ id: integrationWebhookEndpoints.id });
  if (!row) return false;
  await db.update(integrationWebhookDeliveries).set({ status: "cancelled", processingAt: null }).where(and(
    eq(integrationWebhookDeliveries.endpointId, endpointId),
    inArray(integrationWebhookDeliveries.status, ["pending", "retrying"]),
  ));
  return true;
}
