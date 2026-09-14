import { and, eq } from "drizzle-orm";
import { requireAccountPermission } from "../auth/authorize.js";
import { decodeStalwartTokenMetadata, getStalwartAccessToken, getStalwartTokenFormat } from "../auth/stalwartToken.js";
import { config } from "../config.js";
import { db } from "../db/client.js";
import { authUsers, emailAccounts, mailAccountMemberships } from "../db/schema.js";
import { DemoEngine } from "./demo.js";
import { StalwartEngine } from "./stalwart.js";
import type { MailEngine } from "./types.js";

let demoEngine: MailEngine | undefined;
const requestEngines = new Map<string, { engine: MailEngine; expiresAt: number }>();
const accountAddressCache = new Map<string, { address: string; expiresAt: number }>();
const ENGINE_CACHE_TTL_MS = 60_000;
const ACCOUNT_CACHE_TTL_MS = 300_000;

const resolveAccount = async (id: string): Promise<string> => {
  const cached = accountAddressCache.get(id);
  if (cached && cached.expiresAt > Date.now()) return cached.address;
  const [account] = await db.select({ address: emailAccounts.address }).from(emailAccounts).where(eq(emailAccounts.id, id)).limit(1);
  if (!account) throw new Error("mail account not found");
  accountAddressCache.set(id, { address: account.address, expiresAt: Date.now() + ACCOUNT_CACHE_TTL_MS });
  return account.address;
};

export function getEngine(accessToken?: string): MailEngine {
  if (config.mailEngine === "demo") {
    demoEngine ??= new DemoEngine();
    return demoEngine;
  }
  if (!accessToken) throw new Error("user-scoped Stalwart access token required");
  const cached = requestEngines.get(accessToken);
  if (cached && cached.expiresAt > Date.now()) return cached.engine;
  const tokenMetadata = decodeStalwartTokenMetadata(accessToken);
  const sessionContext = {
    mailbox: tokenMetadata?.email ?? "unknown",
    issuer: config.auth.issuer,
    audience: config.auth.stalwartAudience,
    tokenFormat: getStalwartTokenFormat(accessToken),
  };
  const engine = new StalwartEngine({
    resolveAccount,
    jmapUrl: config.stalwart.jmapUrl,
    accessToken,
    sessionTtlMs: config.stalwart.sessionTtlSeconds * 1000,
    onSessionEvent: (event, status) => {
      if (event === "start") console.info("jmap_session_start", sessionContext);
      if (event === "success") console.info("jmap_session_success", sessionContext);
      if (event === "rejected") console.warn("jmap_session_rejected", { ...sessionContext, status });
    },
    onSlowOperation: (operation, durationMs) => console.warn(JSON.stringify({ operation, durationMs: Math.round(durationMs) }), "slow JMAP operation"),
  });
  requestEngines.set(accessToken, { engine, expiresAt: Date.now() + ENGINE_CACHE_TTL_MS });
  return engine;
}

export async function getUserEngine(input: {
  productUserId: string;
  authUserId: string;
  accountId: string;
  headers: Record<string, string>;
  permission?: "read" | "send" | "manage";
}): Promise<MailEngine> {
  if (config.mailEngine === "demo") return getEngine();
  const account = await requireAccountPermission(input.productUserId, input.accountId, input.permission ?? "read");
  if (account.status !== "active" || account.authSetupStatus !== "ready") throw new Error("mailbox is not ready for mail access");
  const [identity] = await db
    .select({ authUserId: mailAccountMemberships.authUserId, email: authUsers.email })
    .from(mailAccountMemberships)
    .innerJoin(authUsers, eq(mailAccountMemberships.authUserId, authUsers.id))
    .where(and(eq(mailAccountMemberships.accountId, account.id), eq(mailAccountMemberships.userId, input.productUserId), eq(mailAccountMemberships.authUserId, input.authUserId)))
    .limit(1);
  if (identity?.authUserId !== input.authUserId || identity.email.toLowerCase() !== account.address.toLowerCase()) {
    throw new Error("mailbox identity is not linked to this Better Auth session");
  }
  const token = await getStalwartAccessToken({ authUserId: input.authUserId, accountId: account.id, headers: input.headers });
  return getEngine(token);
}

export function getServiceEngine(): MailEngine {
  if (config.mailEngine === "demo") return getEngine();
  throw new Error("background Stalwart JMAP access requires a user-scoped OAuth token");
}
