import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { config } from "../config.js";
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
  if (header?.startsWith("Bearer ")) return header.slice("Bearer ".length);
  return null;
};

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
    } else if (config.env !== "production") {
      const token = bearer(req);
      let userId: string | undefined;
      if (!req.user && token) {
        userId = token;
      } else if (!req.user && req.headers["x-gsw-user-id"]) {
        userId = String(req.headers["x-gsw-user-id"]);
      } else if (!req.user && config.dev.userId) {
        userId = config.dev.userId;
      }
      if (userId && !req.user) {
        const user = await resolveUser(config.auth.identityProvider, userId).catch(() => null);
        req.user = user ?? { id: userId };
        if (user && token) req.accessToken = token;
      }
    }

    if (!opts.optional && !req.user) {
      return reply.code(401).send({ error: "unauthorized" });
    }
  });
};
