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
    if (clientId && clientId !== config.auth.mobileClientId) return null;

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
  // When the OAuth request includes a `resource` and the Better Auth JWT plugin
  // is enabled, the provider issues a self-contained JWT access token. Those
  // tokens are intentionally not stored in oauth_access_token, so verify them
  // against the provider JWKS before falling back to opaque-token lookup.
  if (token.split(".").length === 3) {
    const identity = await resolveJwtOAuthBearerIdentity(token);
    if (identity) return identity;
  }

  const [row] = await db
    .select({
      authUserId: authUsers.id,
      email: authUsers.email,
      name: authUsers.name,
      scopes: oauthAccessToken.scopes,
    })
    .from(oauthAccessToken)
    .innerJoin(authUsers, eq(oauthAccessToken.userId, authUsers.id))
    .where(and(eq(oauthAccessToken.token, token), gt(oauthAccessToken.expiresAt, new Date())))
    .limit(1);
  if (!row) return null;
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

    if (session) {
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
      const token = bearer(req);
      if (token) {
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
