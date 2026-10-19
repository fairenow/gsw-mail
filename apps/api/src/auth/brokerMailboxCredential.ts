import { createHash, randomBytes } from "node:crypto";
import { fromNodeHeaders } from "better-auth/node";
import { createRemoteJWKSet } from "jose";
import { and, eq, gt, inArray, isNull } from "drizzle-orm";
import { config } from "../config.js";
import { db } from "../db/client.js";
import { emailAccounts, oauthClient, oauthRefreshToken } from "../db/schema.js";
import { firstPartyStalwartClientIds } from "./firstPartyClients.js";
import { auth } from "./better.js";
import { assertMailboxSessionIdentity } from "./mailboxSessionIdentity.js";
import { verifyStalwartMailboxJwt } from "./verifyStalwartMailboxJwt.js";
import { clearRefreshedStalwartMailboxTokenCache } from "./refreshStalwartMailboxToken.js";

/**
 * Establish a refreshable first-party Stalwart mailbox credential for the
 * signed-in user while they are present (for example when connecting an MCP
 * client). This reuses the product's own mobile OAuth client with
 * `offline_access`, so Better Auth persists a refresh authorization that a
 * later sessionless MCP request can renew. It never mints a mailbox credential
 * from an MCP grant and requires a live, identity-matched browser session.
 */
const jwks = createRemoteJWKSet(new URL(`${config.auth.issuer}/jwks`));

const scope = "openid email offline_access";

export async function establishBrokerMailboxCredential(input: {
  productUserId: string;
  authUserId: string;
  accountId: string;
  headers: Record<string, string>;
  request?: typeof fetch;
}): Promise<{ established: boolean; reason?: string }> {
  const request = input.request ?? fetch;
  const cookie = input.headers.cookie;
  if (!cookie) return { established: false, reason: "mailbox_session_required" };

  const session = await auth.api.getSession({ headers: fromNodeHeaders({ cookie }) });
  assertMailboxSessionIdentity(input.authUserId, session?.user.id ?? null);

  const [account] = await db.select({ address: emailAccounts.address, status: emailAccounts.status, authSetupStatus: emailAccounts.authSetupStatus })
    .from(emailAccounts).where(eq(emailAccounts.id, input.accountId)).limit(1);
  if (!account || account.status !== "active" || account.authSetupStatus !== "ready") {
    return { established: false, reason: "mailbox_not_ready" };
  }

  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = randomBytes(24).toString("base64url");
  const authorize = new URL(`${config.auth.issuer}/oauth2/authorize`);
  authorize.search = new URLSearchParams({
    response_type: "code",
    client_id: config.auth.mobileClientId,
    redirect_uri: config.auth.mobileRedirectUri,
    scope,
    resource: config.auth.stalwartAudience,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();

  const authorizeResponse = await request(authorize, {
    redirect: "manual",
    headers: { cookie, accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  let callbackUrl = authorizeResponse.headers.get("location");
  if (authorizeResponse.status === 200 && authorizeResponse.headers.get("content-type")?.includes("application/json")) {
    const result = await authorizeResponse.json() as { redirect?: boolean; url?: string };
    if (result.redirect === true && typeof result.url === "string") callbackUrl = result.url;
  }
  if (!callbackUrl) {
    console.warn("[mcp-broker] authorization_no_callback", { status: authorizeResponse.status });
    return { established: false, reason: "mailbox_authorization_required" };
  }

  const callback = new URL(callbackUrl, config.auth.issuer);
  if (callback.searchParams.get("state") !== state) return { established: false, reason: "mailbox_authorization_state_mismatch" };
  const error = callback.searchParams.get("error");
  if (error) return { established: false, reason: "mailbox_authorization_denied" };
  const code = callback.searchParams.get("code");
  if (!code) return { established: false, reason: "mailbox_authorization_no_code" };

  const tokenResponse = await request(`${config.auth.issuer}/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: config.auth.mobileRedirectUri,
      client_id: config.auth.mobileClientId,
      code_verifier: verifier,
      resource: config.auth.stalwartAudience,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!tokenResponse.ok) {
    console.warn("[mcp-broker] exchange_failed", { status: tokenResponse.status });
    return { established: false, reason: `mailbox_authorization_exchange_${tokenResponse.status}` };
  }
  const token = await tokenResponse.json() as { access_token?: string };
  if (!token.access_token) return { established: false, reason: "mailbox_authorization_no_token" };

  await verifyStalwartMailboxJwt(token.access_token, {
    productUserId: input.productUserId,
    authUserId: input.authUserId,
    accountId: input.accountId,
  }, jwks, {
    issuer: config.auth.issuer,
    audience: config.auth.stalwartAudience,
    mailboxAddress: account.address,
  });
  // An access token alone cannot keep sessionless MCP mailbox access working.
  // Require a persisted, unrevoked first-party refresh authorization for the
  // same authenticated principal. Never log or return token values.
  const refreshRows = await db.select({
    scopes: oauthRefreshToken.scopes,
  }).from(oauthRefreshToken)
    .innerJoin(oauthClient, eq(oauthRefreshToken.clientId, oauthClient.clientId))
    .where(and(
      eq(oauthRefreshToken.userId, input.authUserId),
      inArray(oauthRefreshToken.clientId, firstPartyStalwartClientIds()),
      eq(oauthClient.disabled, false),
      isNull(oauthRefreshToken.revoked),
      gt(oauthRefreshToken.expiresAt, new Date()),
    )).limit(10);
  const refreshable = refreshRows.some(row => row.scopes.includes("email"));
  console.info("[mcp-broker] persistence_check", { refreshable, candidateCount: refreshRows.length });
  if (!refreshable) return { established: false, reason: "mailbox_refresh_credential_not_persisted" };
  clearRefreshedStalwartMailboxTokenCache(input.authUserId, input.accountId);
  console.info("[oauth] broker_mailbox_credential_established", { authUserId: input.authUserId, accountId: input.accountId });
  return { established: true };
}
