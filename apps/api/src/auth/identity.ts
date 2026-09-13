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

export async function verifyAccessToken(token: string, request: typeof fetch = fetch): Promise<VerifiedClaims | null> {
  if (!token || token.length > 8192) return null;
  const username = config.stalwart.mailUsername;
  if (!username) return null;
  const basic = Buffer.from(`${username}:${config.stalwart.mailPassword ?? ""}`).toString("base64");
  const response = await request(config.auth.introspectUrl, {
    method: "POST",
    headers: { authorization: `Basic ${basic}`, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token, token_type_hint: "access_token" }),
    redirect: "error",
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) return null;
  return identityClaims(await response.json());
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

export const identityClaims = (payload: unknown): VerifiedClaims | null => {
  if (!payload || typeof payload !== "object") return null;
  const claims = payload as Record<string, unknown>;
  if (claims.active !== true || typeof claims.username !== "string" || !claims.username.trim()) return null;
  if (typeof claims.exp !== "number" || !Number.isFinite(claims.exp) || claims.exp <= Date.now() / 1000) return null;
  if (typeof claims.token_type !== "string" || claims.token_type.toLowerCase() !== "bearer") return null;
  return { sub: claims.username, email: undefined, emailVerified: undefined };
};
