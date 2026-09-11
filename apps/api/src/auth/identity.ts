import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { config } from "../config.js";

export interface VerifiedClaims {
  sub: string;
  email: string | undefined;
  emailVerified: boolean | undefined;
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

const jwks = config.auth.jwksUrl
  ? createRemoteJWKSet(new URL(config.auth.jwksUrl), { cacheMaxAge: 600_000 })
  : null;

export async function verifyAccessToken(token: string): Promise<VerifiedClaims | null> {
  if (!jwks) {
    throw new IdentityError("JWKS_URL is not configured; cannot verify access tokens in production");
  }
  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: config.auth.issuer,
      audience: config.auth.audience,
    });
    const sub = payload.sub;
    if (!sub) throw new IdentityError("token missing subject claim");
    return {
      sub,
      email: typeof payload.email === "string" ? payload.email : undefined,
      emailVerified: typeof payload.email_verified === "boolean" ? payload.email_verified : undefined,
    };
  } catch (err) {
    if (err instanceof IdentityError) throw err;
    return null;
  }
}

export async function resolveUser(identityProvider: string, subject: string): Promise<AuthenticatedUser | null> {
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
  return { id: user.id, email: user.email };
}

export const identityClaims = (payload: JWTPayload): VerifiedClaims | null => {
  if (!payload.sub) return null;
  return {
    sub: String(payload.sub),
    email: typeof payload.email === "string" ? payload.email : undefined,
    emailVerified: typeof payload.email_verified === "boolean" ? payload.email_verified : undefined,
  };
};