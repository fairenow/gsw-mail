import { and, desc, eq, gt, inArray, isNull } from "drizzle-orm";
import { createRemoteJWKSet, decodeJwt } from "jose";
import { db } from "../db/client.js";
import { emailAccounts, oauthClient, oauthRefreshToken } from "../db/schema.js";
import { config } from "../config.js";
import { firstPartyStalwartClientIds } from "./firstPartyClients.js";
import { selectRefreshedStoredToken } from "./selectRefreshedStoredToken.js";
import { verifyStalwartMailboxJwt } from "./verifyStalwartMailboxJwt.js";

/**
 * Reuse and refresh an already-authorized first-party Stalwart mailbox
 * credential without a browser session. The MCP bearer is never substituted
 * for a mailbox credential, and no credential is minted from an MCP grant:
 * the user must previously have completed an interactive mailbox
 * authorization that persisted a refreshable token. Fails closed otherwise.
 */
const jwks = createRemoteJWKSet(new URL(`${config.auth.issuer}/jwks`));

const cache = new Map<string, { token: string; expiresAt: number }>();
const inFlight = new Map<string, Promise<string | null>>();

const tokenExpiry = (token: string): number => {
  try {
    const claims = decodeJwt(token);
    if (typeof claims.exp === "number") return claims.exp * 1000;
  } catch {
    // Opaque tokens are not usable as mailbox credentials.
  }
  return 0;
};

async function exchangeRefreshToken(
  input: { clientId: string; refreshToken: string },
  request: typeof fetch,
): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: input.refreshToken,
    client_id: input.clientId,
    resource: config.auth.stalwartAudience,
  });
  const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded" };
  if (input.clientId === config.auth.oauthClientId && config.auth.oauthClientSecret) {
    headers.authorization = `Basic ${Buffer.from(`${input.clientId}:${config.auth.oauthClientSecret}`, "utf8").toString("base64")}`;
  }
  const response = await request(`${config.auth.issuer}/oauth2/token`, {
    method: "POST",
    headers,
    body,
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`mailbox credential refresh failed: HTTP ${response.status}`);
  const payload = await response.json() as { access_token?: string };
  if (!payload.access_token || payload.access_token.split(".").length !== 3) {
    throw new Error("mailbox credential refresh returned no signed token");
  }
  return payload.access_token;
}

async function refreshUncached(input: {
  productUserId: string;
  authUserId: string;
  accountId: string;
  request: typeof fetch;
}): Promise<string | null> {
  const [account] = await db.select({
    address: emailAccounts.address,
    status: emailAccounts.status,
    authSetupStatus: emailAccounts.authSetupStatus,
  }).from(emailAccounts).where(eq(emailAccounts.id, input.accountId)).limit(1);
  if (!account || account.status !== "active" || account.authSetupStatus !== "ready") return null;

  const clientIds = firstPartyStalwartClientIds();
  if (!clientIds.length) return null;
  const candidates = await db.select({
    token: oauthRefreshToken.token,
    clientId: oauthRefreshToken.clientId,
    scopes: oauthRefreshToken.scopes,
  }).from(oauthRefreshToken)
    .innerJoin(oauthClient, eq(oauthRefreshToken.clientId, oauthClient.clientId))
    .where(and(
      eq(oauthClient.disabled, false),
      eq(oauthRefreshToken.userId, input.authUserId),
      inArray(oauthRefreshToken.clientId, clientIds),
      isNull(oauthRefreshToken.revoked),
      gt(oauthRefreshToken.expiresAt, new Date()),
    )).orderBy(desc(oauthRefreshToken.expiresAt)).limit(5);

  const token = await selectRefreshedStoredToken(
    candidates,
    (candidate) => exchangeRefreshToken({ clientId: candidate.clientId, refreshToken: candidate.token }, input.request),
    (candidate) => verifyStalwartMailboxJwt(candidate, {
      productUserId: input.productUserId,
      authUserId: input.authUserId,
      accountId: input.accountId,
    }, jwks, {
      issuer: config.auth.issuer,
      audience: config.auth.stalwartAudience,
      mailboxAddress: account.address,
    }),
  );
  if (token) cache.set(`${input.authUserId}:${input.accountId}`, { token, expiresAt: tokenExpiry(token) - 30_000 });
  return token;
}

export async function refreshStoredStalwartMailboxToken(input: {
  productUserId: string;
  authUserId: string;
  accountId: string;
  request?: typeof fetch;
}): Promise<string | null> {
  const cacheKey = `${input.authUserId}:${input.accountId}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.token;
  if (cached) cache.delete(cacheKey);
  const pending = inFlight.get(cacheKey);
  if (pending) return pending;
  const operation = refreshUncached({ ...input, request: input.request ?? fetch });
  inFlight.set(cacheKey, operation);
  try {
    return await operation;
  } finally {
    if (inFlight.get(cacheKey) === operation) inFlight.delete(cacheKey);
    if (cache.size > 512) cache.delete(cache.keys().next().value!);
  }
}

/** Force the next sessionless lookup to re-read a newly established credential. */
export function clearRefreshedStalwartMailboxTokenCache(authUserId: string, accountId: string): void {
  cache.delete(`${authUserId}:${accountId}`);
}
