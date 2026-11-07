import { persistMailboxCredential } from "./mailboxCredentialVault.js";
import { selectBrokerClient } from "./brokerClientConfig.js";
import { withInternalMailboxIdentity } from "./internalMailboxAuthorization.js";
import { createHash, randomBytes } from "node:crypto";
import { fromNodeHeaders } from "better-auth/node";
import { createRemoteJWKSet } from "jose";
import { and, eq, gt, isNull } from "drizzle-orm";
import { config } from "../config.js";
import { db } from "../db/client.js";
import { emailAccounts, oauthClient, oauthRefreshToken } from "../db/schema.js";
import { auth } from "./better.js";
import { assertMailboxSessionIdentity } from "./mailboxSessionIdentity.js";
import { verifyStalwartMailboxJwt } from "./verifyStalwartMailboxJwt.js";

/**
 * Establish a refreshable first-party Stalwart mailbox credential for the
 * signed-in user while they are present (for example when connecting an MCP
 * client). This uses the product's dedicated confidential Stalwart OAuth
 * client with `offline_access`, so mobile logout or mobile refresh-token
 * rotation cannot invalidate the sessionless MCP mailbox credential. It never mints a mailbox credential
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
  // Never use a mobile client's refresh authorization for the long-lived MCP
  // broker. Its independent grant is allowed only for a live first-party session.
  const broker = selectBrokerClient({
    clientId: config.auth.oauthClientId,
    clientSecret: config.auth.oauthClientSecret,
    redirectUri: config.auth.oauthRedirectUri,
    mobileClientId: config.auth.mobileClientId,
  });
  if (!broker) return { established: false, reason: "mailbox_broker_not_configured" };
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
    client_id: broker.clientId,
    redirect_uri: broker.redirectUri,
    scope,
    resource: config.auth.stalwartAudience,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();

  const authorizeRequest: typeof fetch = request === fetch
    ? async (url, init) => withInternalMailboxIdentity(input.authUserId, () => auth.handler(new Request(String(url), init)))
    : request;
  const authorizeResponse = await authorizeRequest(authorize, {
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
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      authorization: `Basic ${Buffer.from(`${broker.clientId}:${broker.clientSecret}`, "utf8").toString("base64")}`,
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: broker.redirectUri,
      client_id: broker.clientId,
      code_verifier: verifier,
      resource: config.auth.stalwartAudience,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!tokenResponse.ok) {
    console.warn("[mcp-broker] exchange_failed", { status: tokenResponse.status });
    return { established: false, reason: `mailbox_authorization_exchange_${tokenResponse.status}` };
  }
  const token = await tokenResponse.json() as { access_token?: string; refresh_token?: string };
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
      eq(oauthRefreshToken.clientId, broker.clientId),
      eq(oauthClient.disabled, false),
      isNull(oauthRefreshToken.revoked),
      gt(oauthRefreshToken.expiresAt, new Date()),
    )).limit(10);
  const refreshable = refreshRows.some(row => row.scopes.includes("email") && row.scopes.includes("offline_access"));
  console.info("[mcp-broker] persistence_check", { refreshable, candidateCount: refreshRows.length });
  if (!refreshable) return { established: false, reason: "mailbox_refresh_credential_not_persisted" };
  if (!token.refresh_token) return { established: false, reason: "mailbox_refresh_credential_not_returned" };
  await persistMailboxCredential({ ...input, clientId: broker.clientId, accessToken: token.access_token, refreshToken: token.refresh_token });
  console.info("[oauth] broker_mailbox_credential_established", { authUserId: input.authUserId, accountId: input.accountId });
  return { established: true };
}
