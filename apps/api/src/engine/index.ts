import { and, eq } from "drizzle-orm";
import { requireAccountPermission } from "../auth/authorize.js";
import { decodeStalwartTokenMetadata, getStalwartAccessToken, getStalwartTokenFormat } from "../auth/stalwartToken.js";
import { findStoredStalwartMailboxToken } from "../auth/storedStalwartToken.js";
import { refreshStoredStalwartMailboxToken } from "../auth/refreshStalwartMailboxToken.js";
import { config } from "../config.js";
import { db } from "../db/client.js";
import { authUsers, emailAccounts, mailAccountMemberships } from "../db/schema.js";
import { DemoEngine } from "./demo.js";
import { JmapClient, JmapError } from "./jmap.js";
import { StalwartEngine } from "./stalwart.js";
import type { MailEngine } from "./types.js";

let demoEngine: MailEngine | undefined;
const requestEngines = new Map<string, { engine: MailEngine; expiresAt: number }>();
const accountAddressCache = new Map<string, { address: string; expiresAt: number }>();
const identityCache = new Map<string, { email: string; expiresAt: number }>();
const MAX_ENGINE_CACHE_TTL_MS = 10 * 60_000;
const OPAQUE_ENGINE_CACHE_TTL_MS = 5 * 60_000;
const ACCOUNT_CACHE_TTL_MS = 300_000;
const IDENTITY_CACHE_TTL_MS = 60_000;

const resolveAccount = async (id: string): Promise<string> => {
  const cached = accountAddressCache.get(id);
  if (cached && cached.expiresAt > Date.now()) return cached.address;
  const [account] = await db.select({ address: emailAccounts.address }).from(emailAccounts).where(eq(emailAccounts.id, id)).limit(1);
  if (!account) throw new Error("mail account not found");
  accountAddressCache.set(id, { address: account.address, expiresAt: Date.now() + ACCOUNT_CACHE_TTL_MS });
  return account.address;
};

const engineExpiresAt = (accessToken: string): number => {
  const now = Date.now();
  const metadata = decodeStalwartTokenMetadata(accessToken);
  if (metadata?.exp) {
    const tokenExpiry = metadata.exp * 1000 - 30_000;
    return Math.max(now + 30_000, Math.min(now + MAX_ENGINE_CACHE_TTL_MS, tokenExpiry));
  }
  return now + OPAQUE_ENGINE_CACHE_TTL_MS;
};

const trimEngineCache = () => {
  const now = Date.now();
  for (const [key, value] of requestEngines) if (value.expiresAt <= now) requestEngines.delete(key);
  if (requestEngines.size > 256) requestEngines.delete(requestEngines.keys().next().value!);
};

export function getEngine(accessToken?: string): MailEngine {
  if (config.mailEngine === "demo") {
    demoEngine ??= new DemoEngine();
    return demoEngine;
  }
  if (!accessToken) throw new Error("user-scoped Stalwart access token required");
  const cached = requestEngines.get(accessToken);
  if (cached && cached.expiresAt > Date.now()) return cached.engine;
  if (cached) requestEngines.delete(accessToken);
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
  requestEngines.set(accessToken, { engine, expiresAt: engineExpiresAt(accessToken) });
  trimEngineCache();
  return engine;
}

async function getUserMailboxToken(input: {
  productUserId: string;
  authUserId: string;
  accountId: string;
  headers: Record<string, string>;
  permission?: "read" | "send" | "manage";
}): Promise<{ token: string; accountAddress: string }> {
  console.info("[mcp-mailbox] authorization_started");
  let account: Awaited<ReturnType<typeof requireAccountPermission>>;
  try {
    account = await requireAccountPermission(input.productUserId, input.accountId, input.permission ?? "read");
    console.info("[mcp-mailbox] authorization_completed", { allowed: true });
  } catch (error) {
    console.warn("[mcp-mailbox] authorization_failed");
    throw error;
  }
  if (account.status !== "active" || account.authSetupStatus !== "ready") {
    console.warn("[mcp-mailbox] account_not_ready");
    throw new Error("mailbox is not ready for mail access");
  }
  console.info("[mcp-mailbox] identity_lookup_started");

  const identityKey = `${input.productUserId}:${input.authUserId}:${account.id}`;
  const cachedIdentity = identityCache.get(identityKey);
  let identityEmail = cachedIdentity && cachedIdentity.expiresAt > Date.now() ? cachedIdentity.email : undefined;
  if (!identityEmail) {
    const [identity] = await db
      .select({ authUserId: mailAccountMemberships.authUserId, email: authUsers.email })
      .from(mailAccountMemberships)
      .innerJoin(authUsers, eq(mailAccountMemberships.authUserId, authUsers.id))
      .where(and(eq(mailAccountMemberships.accountId, account.id), eq(mailAccountMemberships.userId, input.productUserId), eq(mailAccountMemberships.authUserId, input.authUserId)))
      .limit(1);
    if (identity?.authUserId !== input.authUserId) throw new Error("mailbox identity is not linked to this Better Auth session");
    identityEmail = identity.email;
    identityCache.set(identityKey, { email: identityEmail, expiresAt: Date.now() + IDENTITY_CACHE_TTL_MS });
    if (identityCache.size > 512) identityCache.delete(identityCache.keys().next().value!);
  }
  console.info("[mcp-mailbox] identity_lookup_completed", { matched: identityEmail.toLowerCase() === account.address.toLowerCase() });
  if (identityEmail.toLowerCase() !== account.address.toLowerCase()) {
    identityCache.delete(identityKey);
    throw new Error("mailbox identity is not linked to this Better Auth session");
  }

  // Sessionless clients may only reuse an already-issued, verified first-party
  // credential after this function has checked mailbox ACL and identity linkage.
  // An expired access token is renewed server-side from the persisted first-party
  // refresh authorization; a third-party MCP bearer is never substituted for it.
  const sessionless = Object.keys(input.headers).length === 0;
  let stored: string | null = null;
  let renewed: string | null = null;
  if (sessionless) {
    console.info("[mcp-mailbox] credential_lookup_started");
    try {
      stored = await findStoredStalwartMailboxToken({
        productUserId: input.productUserId,
        authUserId: input.authUserId,
        accountId: account.id,
      });
      console.info("[mcp-mailbox] stored_lookup_completed", { found: Boolean(stored) });
    } catch {
      // Never return an unverified access token. A failed access-token lookup
      // must not prevent independent verification of a persisted refresh grant.
      console.warn("[mcp-mailbox] stored_lookup_failed");
    }
    if (!stored) {
      console.info("[mcp-mailbox] refresh_lookup_started");
      try {
        renewed = await refreshStoredStalwartMailboxToken({
          productUserId: input.productUserId,
          authUserId: input.authUserId,
          accountId: account.id,
        });
        console.info("[mcp-mailbox] refresh_lookup_completed", { verified: Boolean(renewed) });
      } catch {
        console.warn("[mcp-mailbox] refresh_lookup_failed");
      }
    }
  }
  renewed ??= stored;
  // Report credential *source* only. Never log token values, claims, email addresses,
  // account/user identifiers, request headers, or upstream exception messages.
  if (sessionless) console.info("[mcp-mailbox] credential_resolution", {
    stage: stored ? "stored_access_token" : renewed ? "refreshed_access_token" : "no_persisted_credential",
  });
  let token: string;
  try {
    token = renewed ?? await getStalwartAccessToken({ authUserId: input.authUserId, accountId: account.id, headers: input.headers });
  } catch (error) {
    if (sessionless) console.warn("[mcp-mailbox] credential_resolution_failed", {
      stage: "interactive_fallback",
      reason: error instanceof Error && error.message === "mailbox_session_required" ? "mailbox_session_required" : "unclassified",
    });
    throw error;
  }
  console.info("[mcp-mailbox] verified_credential_resolved");
  return { token, accountAddress: account.address };
}

export async function getUserEngine(input: {
  productUserId: string;
  authUserId: string;
  accountId: string;
  headers: Record<string, string>;
  permission?: "read" | "send" | "manage";
}): Promise<MailEngine> {
  if (config.mailEngine === "demo") {
    await requireAccountPermission(input.productUserId, input.accountId, input.permission ?? "read");
    return getEngine();
  }
  const { token } = await getUserMailboxToken(input);
  return getEngine(token);
}

export type UserMessageChanges = {
  oldState: string | null;
  newState: string;
  hasMoreChanges: boolean;
  created: string[];
  updated: string[];
  destroyed: string[];
  resetRequired: boolean;
};

export async function getUserMessageChanges(input: {
  productUserId: string;
  authUserId: string;
  accountId: string;
  headers: Record<string, string>;
  sinceState?: string | undefined;
}): Promise<UserMessageChanges> {
  if (config.mailEngine === "demo") {
    return {
      oldState: input.sinceState ?? null,
      newState: "demo-state-1",
      hasMoreChanges: false,
      created: [],
      updated: [],
      destroyed: [],
      resetRequired: false,
    };
  }

  const { token, accountAddress } = await getUserMailboxToken({ ...input, permission: "read" });
  const client = new JmapClient({
    baseUrl: config.stalwart.jmapUrl,
    token,
    sessionTtlMs: config.stalwart.sessionTtlSeconds * 1000,
  });
  const session = await client.session();
  const accountId = client.resolveAccountId(session, accountAddress);

  const currentState = async (): Promise<string> => {
    const response = await client.call([["Email/get", { accountId, ids: [], properties: ["id"] }, "state"]]);
    const state = response[0]?.[1]?.state;
    if (typeof state !== "string") throw new Error("Stalwart Email/get did not return a state token");
    return state;
  };

  if (!input.sinceState) {
    return {
      oldState: null,
      newState: await currentState(),
      hasMoreChanges: false,
      created: [],
      updated: [],
      destroyed: [],
      resetRequired: false,
    };
  }

  try {
    const response = await client.call([["Email/changes", { accountId, sinceState: input.sinceState, maxChanges: 250 }, "changes"]]);
    const payload = response[0]?.[1] ?? {};
    return {
      oldState: typeof payload.oldState === "string" ? payload.oldState : input.sinceState,
      newState: typeof payload.newState === "string" ? payload.newState : input.sinceState,
      hasMoreChanges: payload.hasMoreChanges === true,
      created: Array.isArray(payload.created) ? payload.created.filter((id): id is string => typeof id === "string") : [],
      updated: Array.isArray(payload.updated) ? payload.updated.filter((id): id is string => typeof id === "string") : [],
      destroyed: Array.isArray(payload.destroyed) ? payload.destroyed.filter((id): id is string => typeof id === "string") : [],
      resetRequired: false,
    };
  } catch (error) {
    if (!(error instanceof JmapError) || error.type !== "cannotCalculateChanges") throw error;
    return {
      oldState: input.sinceState,
      newState: await currentState(),
      hasMoreChanges: false,
      created: [],
      updated: [],
      destroyed: [],
      resetRequired: true,
    };
  }
}

export function getServiceEngine(): MailEngine {
  if (config.mailEngine === "demo") return getEngine();
  throw new Error("background Stalwart JMAP access requires a user-scoped OAuth token");
}
