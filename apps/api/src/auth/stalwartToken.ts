import { createHash, randomBytes } from "node:crypto";
import { config } from "../config.js";

export interface StalwartTokenRequest {
  authUserId: string;
  accountId: string;
  headers: Record<string, string>;
}

interface CachedToken {
  token: string;
  expiresAt: number;
}

const cache = new Map<string, CachedToken>();

export async function getStalwartAccessToken(input: StalwartTokenRequest, request: typeof fetch = fetch): Promise<string> {
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

  const authorizeResponse = await request(authorize, {
    redirect: "manual",
    headers: input.headers,
    signal: AbortSignal.timeout(10_000),
  });
  if (authorizeResponse.status < 300 || authorizeResponse.status >= 400) {
    throw new Error(`Better Auth OAuth authorization failed: HTTP ${authorizeResponse.status}`);
  }
  const location = authorizeResponse.headers.get("location");
  if (!location) throw new Error("Better Auth OAuth authorization did not return a callback");
  const callback = new URL(location);
  if (callback.searchParams.get("state") !== state) throw new Error("Better Auth OAuth state validation failed");
  const error = callback.searchParams.get("error");
  if (error) throw new Error(`Better Auth OAuth authorization denied: ${error}`);
  const code = callback.searchParams.get("code");
  if (!code) throw new Error("Better Auth OAuth authorization did not return a code");

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
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!tokenResponse.ok) throw new Error(`Better Auth OAuth token exchange failed: HTTP ${tokenResponse.status}`);
  const token = await tokenResponse.json() as { access_token?: string; expires_in?: number };
  if (!token.access_token) throw new Error("Better Auth OAuth token response was invalid");
  const expiresAt = Date.now() + Math.max(60, (token.expires_in ?? config.auth.tokenTtlSeconds) - 60) * 1000;
  cache.set(cacheKey, { token: token.access_token, expiresAt });
  if (cache.size > 1024) cache.delete(cache.keys().next().value!);
  return token.access_token;
}
