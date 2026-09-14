import { config } from "../config.js";
import { createRemoteJWKSet, jwtVerify } from "jose";

export interface VerifiedClaims {
  sub: string;
  email: string | undefined;
  emailVerified: boolean | undefined;
  expiresAt: number;
}

export interface AuthenticatedUser {
  id: string;
  email?: string;
}

export class IdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IdentityError";
  }
}

const TOKEN_CACHE_TTL_MS = 30_000;
const USER_CACHE_TTL_MS = 30_000;
const MAX_CACHE_ENTRIES = 512;
const tokenCache = new Map<string, { claims: VerifiedClaims; expiresAt: number }>();
const userCache = new Map<string, { user: AuthenticatedUser; expiresAt: number }>();

export async function verifyAccessToken(token: string, request: typeof fetch = fetch): Promise<VerifiedClaims | null> {
  if (!token || token.length > 8192) return null;
  const cached = request === fetch ? tokenCache.get(token) : undefined;
  if (cached && cached.expiresAt > Date.now()) return cached.claims;
  if (cached) tokenCache.delete(token);
  try {
    const jwks = createRemoteJWKSet(new URL(`${config.auth.issuer}/jwks`));
    const verified = await jwtVerify(token, jwks, { issuer: config.auth.issuer, audience: config.auth.stalwartAudience });
    if (typeof verified.payload.sub !== "string" || typeof verified.payload.exp !== "number") return null;
    const claims: VerifiedClaims = {
      sub: verified.payload.sub,
      email: typeof verified.payload.email === "string" ? verified.payload.email : undefined,
      emailVerified: verified.payload.email_verified === true,
      expiresAt: verified.payload.exp * 1000,
    };
    if (request === fetch) remember(tokenCache, token, { claims, expiresAt: Math.min(claims.expiresAt, Date.now() + TOKEN_CACHE_TTL_MS) });
    return claims;
  } catch {
    return null;
  }
}

export async function resolveUser(identityProvider: string, subject: string): Promise<AuthenticatedUser | null> {
  const cacheKey = `${identityProvider}:${subject}`;
  const cached = userCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.user;
  if (cached) userCache.delete(cacheKey);
  const { db } = await import("../db/client.js");
  const { eq, and } = await import("drizzle-orm");
  const { users } = await import("../db/schema.js");
  const rows = await db
    .select({ id: users.id, email: users.email, status: users.status })
    .from(users)
    .where(and(eq(users.identityProvider, identityProvider), eq(users.identitySubject, subject)))
    .limit(1);
  const user = rows[0];
  if (!user) return null;
  if (user.status !== "active") return null;
  const resolved = { id: user.id, email: user.email };
  remember(userCache, cacheKey, { user: resolved, expiresAt: Date.now() + USER_CACHE_TTL_MS });
  return resolved;
}

export const identityClaims = (payload: unknown): VerifiedClaims | null => {
  if (!payload || typeof payload !== "object") return null;
  const claims = payload as Record<string, unknown>;
  if (claims.active !== true || typeof claims.username !== "string" || !claims.username.trim()) return null;
  if (typeof claims.exp !== "number" || !Number.isFinite(claims.exp) || claims.exp <= Date.now() / 1000) return null;
  if (typeof claims.token_type !== "string" || claims.token_type.toLowerCase() !== "bearer") return null;
  return { sub: claims.username, email: undefined, emailVerified: undefined, expiresAt: claims.exp * 1000 };
};

function remember<T>(cache: Map<string, T>, key: string, value: T): void {
  cache.set(key, value);
  if (cache.size <= MAX_CACHE_ENTRIES) return;
  const oldest = cache.keys().next().value;
  if (oldest) cache.delete(oldest);
}
