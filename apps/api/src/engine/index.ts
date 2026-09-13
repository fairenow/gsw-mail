import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { emailAccounts } from "../db/schema.js";
import { config } from "../config.js";
import { DemoEngine } from "./demo.js";
import { StalwartEngine } from "./stalwart.js";
import type { MailEngine } from "./types.js";

let demoEngine: MailEngine | undefined;
let serviceEngine: MailEngine | undefined;
const requestEngines = new Map<string, { engine: MailEngine; expiresAt: number }>();
const accountAddressCache = new Map<string, { address: string; expiresAt: number }>();
const ENGINE_CACHE_TTL_MS = 60_000;
const ACCOUNT_CACHE_TTL_MS = 300_000;
const MAX_REQUEST_ENGINES = 256;
const MAX_ACCOUNT_CACHE_ENTRIES = 1024;

const resolveAccount = async (id: string): Promise<string> => {
  const cached = accountAddressCache.get(id);
  if (cached && cached.expiresAt > Date.now()) return cached.address;
  if (cached) accountAddressCache.delete(id);
  const [account] = await db.select({ address: emailAccounts.address }).from(emailAccounts).where(eq(emailAccounts.id, id)).limit(1);
  if (!account) throw new Error("mail account not found");
  accountAddressCache.set(id, { address: account.address, expiresAt: Date.now() + ACCOUNT_CACHE_TTL_MS });
  if (accountAddressCache.size > MAX_ACCOUNT_CACHE_ENTRIES) accountAddressCache.delete(accountAddressCache.keys().next().value!);
  return account.address;
};

export function getEngine(accessToken?: string): MailEngine {
  if (config.mailEngine === "demo") {
    demoEngine ??= new DemoEngine();
    return demoEngine;
  }

  if (!accessToken) return getServiceEngine();
  const cached = requestEngines.get(accessToken);
  if (cached && cached.expiresAt > Date.now()) return cached.engine;
  if (cached) requestEngines.delete(accessToken);
  const engine = new StalwartEngine({
    resolveAccount,
    jmapUrl: config.stalwart.jmapUrl,
    accessToken,
    sessionTtlMs: config.stalwart.sessionTtlSeconds * 1000,
    onSlowOperation: (operation, durationMs) => console.warn(JSON.stringify({ operation, durationMs: Math.round(durationMs) }), "slow JMAP operation"),
  });
  requestEngines.set(accessToken, { engine, expiresAt: Date.now() + ENGINE_CACHE_TTL_MS });
  if (requestEngines.size > MAX_REQUEST_ENGINES) requestEngines.delete(requestEngines.keys().next().value!);
  return engine;
}

export function getServiceEngine(): MailEngine {
  if (config.mailEngine === "demo") {
    return getEngine();
  }
  serviceEngine ??= new StalwartEngine({
    resolveAccount,
    jmapUrl: config.stalwart.jmapUrl,
    ...(config.stalwart.mailUsername ? { serviceUsername: config.stalwart.mailUsername } : {}),
    ...(config.stalwart.mailPassword ? { servicePassword: config.stalwart.mailPassword } : {}),
    sessionTtlMs: config.stalwart.sessionTtlSeconds * 1000,
  });
  return serviceEngine;
}
