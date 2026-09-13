import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { config } from "../config.js";
import { provisionUserFromIdentity } from "./provision.js";
import { resolveUser, verifyAccessToken, type AuthenticatedUser } from "./identity.js";

declare module "fastify" {
  interface FastifyRequest {
    user?: AuthenticatedUser;
    accessToken?: string;
  }
}

const bearer = (req: FastifyRequest): string | null => {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) return header.slice("Bearer ".length);
  return null;
};

export const requireUser = async (app: FastifyInstance, opts: { optional?: boolean }): Promise<void> => {
  app.addHook("onRequest", async (req: FastifyRequest, reply: FastifyReply) => {
    if (config.env === "production") {
      const token = bearer(req);
      if (token) {
        const claims = await verifyAccessToken(token).catch(() => null);
        if (claims) {
          const user = await provisionUserFromIdentity(config.auth.identityProvider, claims.sub).catch((error: unknown) => {
            req.log.warn({
              identitySubject: claims.sub,
              error: error instanceof Error ? error.message : String(error),
            }, "authenticated identity provisioning failed");
            return null;
          });
          if (user) {
            req.user = user;
            req.accessToken = token;
            req.log.info({ identitySubject: claims.sub, userId: user.id, userEmail: user.email }, "authenticated identity resolved");
          }
        }
      }
    } else {
      const token = bearer(req);
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

    if (!opts.optional && !req.user) {
      return reply.code(401).send({ error: "unauthorized" });
    }
  });
};
