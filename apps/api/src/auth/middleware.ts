import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { and, eq, gt } from "drizzle-orm";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { config } from "../config.js";
import { db } from "../db/client.js";
import { authUsers, oauthAccessToken } from "../db/schema.js";
import { provisionControlPlaneUser, provisionUserFromIdentity } from "./provision.js";
import { auth } from "./better.js";
import { fromNodeHeaders } from "better-auth/node";
import { resolveUser, type AuthenticatedUser } from "./identity.js";

declare module "fastify" {
  interface FastifyRequest {
    user?: AuthenticatedUser;
    accessToken?: string;
    authUserId?: string;
  }
}

interface IdentityOperations {
  resolve: typeof resolveUser;
  provision: typeof provisionUserFromIdentity;
}

export async function resolveOrProvisionUser(identityProvider: string, subject: string, operations: IdentityOperations = { resolve: resolveUser, provision: provisionUserFromIdentity }): Promise<{ user: AuthenticatedUser; provisioned: boolean }> {
  const existing = await operations.resolve(identityProvider, subject);
  if (existing) return { user: existing, provisioned: false };
  return { user: await operations.provision(identityProvider, subject), provisioned: true };
}

const bearer = (req: FastifyRequest): string | null => {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) return header.slice("Bearer ".length).trim() || null;
  return null;
};

export type RequestAuthSource = "session" | "bearer" | "none";

export function selectRequestAuthSource(hasSession: boolean, hasBearer: boolean): RequestAuthSource {
  if (hasSession) return "session";
  if (hasBearer) return "bearer";
  return "none";
}

export interface OAuthBearerIdentity {
  authUserId: string;
  email: string;
  name: string;
  scopes: string[];
}

export function normalizeOAuthScopes(value: unknown): string[] {
  if (typeof value === "string") return value.split(/\s+/).map((scope) => scope.trim()).filter(Boolean);
  if (Array.isArray(value)) return value.filter((scope): scope is string => typeof scope === "string" && scope.length > 0);
  return [];
}

const audienceIncludes = (audience: unknown, expected: string): boolean => {
  if (typeof audience === "string") return audience === expected;
  return Array.isArray(audience) && audience.some((value) => value === expected);
};

export function isTrustedProductBearerClient(clientId: string | undefined): boolean {
  return clientId === config.auth.mobileClientId;
}

export function isTrustedProductJwtBearer(clientId: string | undefined, audience: unknown): boolean {
  return isTrustedProductBearerClient(clientId) && audienceIncludes(audience, config.auth.stalwartAudience);
}

const oauthJwks = createRemoteJWKSet(new URL(`${config.auth.issuer}/jwks`));

async function resolveJwtOAuthBearerIdentity(token: string): Promise<OAuthBearerIdentity | null> {
  try {
    const { payload } = await jwtVerify(token, oauthJwks, {
      issuer: config.auth.issuer,
      audience: config.auth.stalwartAudience,
    });
    const scopes = normalizeOAuthScopes(payload.scope);
    if (!scopes.includes("openid") || !scopes.includes("email")) return null;
    if (typeof payload.sub !== "string" || !payload.sub) return null;

    const clientId = typeof payload.client_id === "string"
      ? payload.client_id
      : typeof payload.azp === "string"
        ? payload.azp
        : undefined;
    if (!isTrustedProductJwtBearer(clientId, payload.aud)) return null;

    const [user] = await db
      .select({ id: authUsers.id, email: authUsers.email, name: authUsers.name })
      .from(authUsers)
      .where(eq(authUsers.id, payload.sub))
      .limit(1);
    if (!user) return null;

    return { authUserId: user.id, email: user.email, name: user.name, scopes };
  } catch {
    return null;
  }
}

export async function resolveOAuthBearerIdentity(token: string): Promise<OAuthBearerIdentity | null> {
  // Resource-bound Better Auth JWT access tokens are intentionally not stored in
  // oauth_access_token. Verify them cryptographically, then require both the
  // explicitly trusted first-party mobile client and the expected Stalwart
  // resource audience before treating them as GSW product API authentication.
  if (token.split(".").length === 3) {
    const identity = await resolveJwtOAuthBearerIdentity(token);
    if (identity) return identity;
    return null;
  }

  // Opaque access-token rows do not currently persist a resource/audience. Do
  // not infer product authorization from scopes or user identity: only the
  // explicitly trusted GSW Mobile OAuth client may authenticate product APIs
  // through this legacy opaque-token path.
  const [row] = await db
    .select({
      authUserId: authUsers.id,
      email: authUsers.email,
      name: authUsers.name,
      scopes: oauthAccessToken.scopes,
      clientId: oauthAccessToken.clientId,
    })
    .from(oauthAccessToken)
    .innerJoin(authUsers, eq(oauthAccessToken.userId, authUsers.id))
    .where(and(eq(oauthAccessToken.token, token), gt(oauthAccessToken.expiresAt, new Date())))
    .limit(1);
  if (!row || !isTrustedProductBearerClient(row.clientId)) return null;
  const scopes = row.scopes ?? [];
  if (!scopes.includes("openid") || !scopes.includes("email")) return null;
  return { authUserId: row.authUserId, email: row.email, name: row.name, scopes };
}

export const requireUser = async (app: FastifyInstance, opts: { optional?: boolean }): Promise<void> => {
  app.addHook("onRequest", async (req: FastifyRequest, reply: FastifyReply) => {
    const startedAt = Date.now();
    let session;
    try {
      session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers), query: { disableCookieCache: true } });
    } catch {
      req.log.warn({ durationMs: Date.now() - startedAt }, "Better Auth session resolution unavailable");
      return reply.code(503).send({ error: "session_resolution_unavailable" });
    }

    const token = session ? null : bearer(req);
    const authSource = selectRequestAuthSource(Boolean(session), Boolean(token));

    if (authSource === "session" && session) {
      req.authUserId = session.user.id;
      req.log.info({ authUserId: session.user.id, durationMs: Date.now() - startedAt }, "Better Auth session confirmed");
      try {
        req.user = await provisionControlPlaneUser(session.user.id, session.user.email, session.user.name);
        req.log.info({ authUserId: session.user.id, userId: req.user.id, durationMs: Date.now() - startedAt }, "product identity resolved");
      } catch {
        req.log.warn({ authUserId: session.user.id, durationMs: Date.now() - startedAt }, "product identity resolution failed");
        return reply.code(409).send({ error: "account_resolution_failed" });
      }
    } else {
      if (authSource === "bearer" && token) {
        try {
          const identity = await resolveOAuthBearerIdentity(token);
          if (identity) {
            req.authUserId = identity.authUserId;
            req.accessToken = token;
            req.user = await provisionControlPlaneUser(identity.authUserId, identity.email, identity.name);
            req.log.info({ authUserId: identity.authUserId, userId: req.user.id, tokenFormat: token.split(".").length === 3 ? "jwt" : "opaque", durationMs: Date.now() - startedAt }, "OAuth bearer session confirmed");
          } else {
            req.log.warn({ tokenFormat: token.split(".").length === 3 ? "jwt" : "opaque", durationMs: Date.now() - startedAt }, "OAuth bearer token rejected");
          }
        } catch {
          req.log.warn({ durationMs: Date.now() - startedAt }, "OAuth bearer session resolution failed");
          return reply.code(503).send({ error: "session_resolution_unavailable" });
        }
      }

      if (!req.user && config.env !== "production") {
        let userId: string | undefined;
        if (token) {
          userId = token;
        } else if (req.headers["x-gsw-user-id"]) {
          userId = String(req.headers["x-gsw-user-id"]);
        } else if (config.dev.userId) {
          userId = config.dev.userId;
        }
        if (userId) {
          const user = await resolveUser(config.auth.identityProvider, userId).catch(() => null);
          req.user = user ?? { id: userId };
          if (user && token) req.accessToken = token;
        }
      }
    }

    if (!opts.optional && !req.user) {
      return reply.code(401).send({ error: "unauthorized" });
    }
  });
};
