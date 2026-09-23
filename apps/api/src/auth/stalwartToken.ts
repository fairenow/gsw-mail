import { createHash, randomBytes } from "node:crypto";
import { fromNodeHeaders } from "better-auth/node";
import { and, eq, gt } from "drizzle-orm";
import { decodeJwt, decodeProtectedHeader } from "jose";
import { config } from "../config.js";
import { db } from "../db/client.js";
import { oauthAccessToken } from "../db/schema.js";
import { auth } from "./better.js";

export interface StalwartTokenRequest {
  authUserId: string;
  accountId: string;
  headers: Record<string, string>;
}

interface CachedToken {
  token: string;
  expiresAt: number;
}

export interface StalwartTokenMetadata {
  alg?: string;
  kid?: string;
  iss?: string;
  aud?: string | string[];
  sub?: string;
  email?: string;
  preferred_username?: string;
  scope?: string | string[];
  exp?: number;
}

export type StalwartTokenFormat = "jwt" | "opaque";

export function getStalwartTokenFormat(token: string): StalwartTokenFormat {
  return token.split(".").length === 3 ? "jwt" : "opaque";
}

export function decodeStalwartTokenMetadata(token: string): StalwartTokenMetadata | undefined {
  try {
    const header = decodeProtectedHeader(token);
    const claims = decodeJwt(token);
    const aud = typeof claims.aud === "string"
      ? claims.aud
      : Array.isArray(claims.aud) && claims.aud.every((value) => typeof value === "string")
        ? claims.aud
        : undefined;
    const scope = typeof claims.scope === "string"
      ? claims.scope
      : Array.isArray(claims.scope) && claims.scope.every((value) => typeof value === "string")
        ? claims.scope
        : undefined;
    return {
      ...(typeof header.alg === "string" ? { alg: header.alg } : {}),
      ...(typeof header.kid === "string" ? { kid: header.kid } : {}),
      ...(typeof claims.iss === "string" ? { iss: claims.iss } : {}),
      ...(aud ? { aud } : {}),
      ...(typeof claims.sub === "string" ? { sub: claims.sub } : {}),
      ...(typeof claims.email === "string" ? { email: claims.email } : {}),
      ...(typeof claims.preferred_username === "string" ? { preferred_username: claims.preferred_username } : {}),
      ...(scope ? { scope } : {}),
      ...(typeof claims.exp === "number" ? { exp: claims.exp } : {}),
    };
  } catch {
    return undefined;
  }
}

const cache = new Map<string, CachedToken>();
const inFlight = new Map<string, Promise<string>>();

const bearerFromHeaders = (headers: Record<string, string>): string | null => {
  const authorization = headers.authorization ?? headers.Authorization;
  if (!authorization?.startsWith("Bearer ")) return null;
  return authorization.slice("Bearer ".length).trim() || null;
};

async function mobileStalwartBearer(input: StalwartTokenRequest): Promise<string | null> {
  const token = bearerFromHeaders(input.headers);
  if (!token) return null;
  const [record] = await db
    .select({ token: oauthAccessToken.token, scopes: oauthAccessToken.scopes })
    .from(oauthAccessToken)
    .where(and(
      eq(oauthAccessToken.token, token),
      eq(oauthAccessToken.userId, input.authUserId),
      eq(oauthAccessToken.clientId, config.auth.mobileClientId),
      gt(oauthAccessToken.expiresAt, new Date()),
    ))
    .limit(1);
  if (!record || !record.scopes.includes("email")) return null;
  return record.token;
}

export async function getStalwartAccessToken(input: StalwartTokenRequest, request: typeof fetch = fetch): Promise<string> {
  const directMobileToken = await mobileStalwartBearer(input);
  if (directMobileToken) return directMobileToken;

  const cacheKey = `${input.authUserId}:${input.accountId}:${config.auth.stalwartAudience}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  const pending = inFlight.get(cacheKey);
  if (pending) return pending;
  const operation = getStalwartAccessTokenUncached(input, request);
  inFlight.set(cacheKey, operation);
  try {
    return await operation;
  } finally {
    if (inFlight.get(cacheKey) === operation) inFlight.delete(cacheKey);
  }
}

async function getStalwartAccessTokenUncached(input: StalwartTokenRequest, request: typeof fetch = fetch): Promise<string> {
  if (!config.auth.oauthClientId || !config.auth.oauthClientSecret) {
    throw new Error("Better Auth Stalwart OAuth client is not configured");
  }
  const cacheKey = `${input.authUserId}:${input.accountId}:${config.auth.stalwartAudience}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  if (cached) cache.delete(cacheKey);

  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = randomBytes(24).toString("base64url");
  const authorize = new URL(`${config.auth.issuer}/oauth2/authorize`);
  authorize.search = new URLSearchParams({
    response_type: "code",
    client_id: config.auth.oauthClientId,
    redirect_uri: config.auth.oauthRedirectUri,
    scope: "openid email",
    resource: config.auth.stalwartAudience,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();

  const cookiePresent = Boolean(input.headers.cookie);
  const authorizeHeaders: Record<string, string> = {
    ...(input.headers.cookie ? { cookie: input.headers.cookie } : {}),
    ...(input.headers["user-agent"] ? { "user-agent": input.headers["user-agent"] } : {}),
    accept: "application/json",
  };
  let sessionBeforeAuthorize: string | null = null;
  try {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(authorizeHeaders) });
    sessionBeforeAuthorize = session?.user.id ?? null;
  } catch {
    sessionBeforeAuthorize = null;
  }
  console.info("[oauth] authorize_start", {
    authUserId: input.authUserId,
    accountId: input.accountId,
    oauthClientId: config.auth.oauthClientId,
    redirectUri: config.auth.oauthRedirectUri,
    resource: config.auth.stalwartAudience,
    scope: "openid email",
    cookiePresent,
    sessionBeforeAuthorize,
  });

  const startedAt = Date.now();
  const authorizeResponse = await request(authorize, {
    redirect: "manual",
    headers: authorizeHeaders,
    signal: AbortSignal.timeout(10_000),
  });
  const contentType = authorizeResponse.headers.get("content-type");
  let callbackUrl = authorizeResponse.headers.get("location");
  let jsonRedirectPresent = false;
  let responseBody = "";
  if (authorizeResponse.status === 200 && contentType?.includes("application/json")) {
    const result = await authorizeResponse.json() as { redirect?: boolean; url?: string };
    if (result.redirect === true && typeof result.url === "string") {
      callbackUrl = result.url;
      jsonRedirectPresent = true;
    }
  }
  const responseMode = callbackUrl ? (jsonRedirectPresent ? "json_redirect" : "http_redirect") : "interactive";
  console.info("[oauth] authorize_response", {
    status: authorizeResponse.status,
    contentType,
    responseMode,
    locationPresent: Boolean(authorizeResponse.headers.get("location")),
    jsonRedirectPresent,
    durationMs: Date.now() - startedAt,
  });
  if (!callbackUrl) {
    if (authorizeResponse.status !== 200 || !contentType?.includes("application/json")) responseBody = (await authorizeResponse.text()).slice(0, 300).toLowerCase();
    const body = responseBody;
    const classification = body.includes("consent")
      ? "consent_required"
      : body.includes("sign in") || body.includes("login")
        ? "login_required"
        : body.includes("invalid_client")
          ? "invalid_client"
          : body.includes("redirect_uri")
            ? "invalid_redirect_uri"
            : body.includes("scope")
              ? "invalid_scope"
              : body.includes("resource")
                ? "invalid_resource"
                : authorizeResponse.status === 200
                  ? "unknown_interactive_response"
                  : "oauth_error_response";
    console.warn("[oauth] authorize_failed", { status: authorizeResponse.status, classification });
    if (authorizeResponse.status === 200) throw new Error("oauth_interaction_required");
    throw new Error(`Better Auth OAuth authorization failed: HTTP ${authorizeResponse.status}`);
  }
  const callback = new URL(callbackUrl, config.auth.issuer);
  if (callback.searchParams.get("state") !== state) throw new Error("Better Auth OAuth state validation failed");
  const error = callback.searchParams.get("error");
  if (error) throw new Error(`Better Auth OAuth authorization denied: ${error}`);
  const code = callback.searchParams.get("code");
  if (!code) throw new Error("Better Auth OAuth authorization did not return a code");
  console.info("[oauth] authorization_code_received", { authUserId: input.authUserId, accountId: input.accountId });

  console.info("[oauth] token_exchange_start", { authUserId: input.authUserId, accountId: input.accountId });
  const tokenResponse = await request(`${config.auth.issuer}/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${config.auth.oauthClientId}:${config.auth.oauthClientSecret}`, "utf8").toString("base64")}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: config.auth.oauthRedirectUri,
      client_id: config.auth.oauthClientId,
      code_verifier: verifier,
      resource: config.auth.stalwartAudience,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!tokenResponse.ok) throw new Error(`Better Auth OAuth token exchange failed: HTTP ${tokenResponse.status}`);
  const token = await tokenResponse.json() as { access_token?: string; expires_in?: number };
  if (!token.access_token) throw new Error("Better Auth OAuth token response was invalid");
  const tokenMetadata = decodeStalwartTokenMetadata(token.access_token);
  console.info("[oauth] token_received", {
    authUserId: input.authUserId,
    accountId: input.accountId,
    expiresIn: token.expires_in ?? config.auth.tokenTtlSeconds,
    oauth_token_format: getStalwartTokenFormat(token.access_token),
    oauth_token_alg: tokenMetadata?.alg,
    oauth_token_kid: tokenMetadata?.kid,
    oauth_token_iss: tokenMetadata?.iss,
    oauth_token_aud: tokenMetadata?.aud,
    oauth_token_sub: tokenMetadata?.sub,
    oauth_token_email: tokenMetadata?.email,
    oauth_token_preferred_username: tokenMetadata?.preferred_username,
    oauth_token_scope: tokenMetadata?.scope,
    oauth_token_exp: tokenMetadata?.exp,
  });
  const expiresAt = Date.now() + Math.max(60, (token.expires_in ?? config.auth.tokenTtlSeconds) - 60) * 1000;
  cache.set(cacheKey, { token: token.access_token, expiresAt });
  if (cache.size > 1024) cache.delete(cache.keys().next().value!);
  return token.access_token;
}
