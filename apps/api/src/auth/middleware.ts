import type { FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { config } from "../config.js";
import { forbidden, unauthorized } from "../lib/errors.js";

declare module "fastify" {
  interface FastifyRequest {
    user?: { id: string };
  }
}

const bearer = (req: FastifyRequest): string | null => {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) return header.slice("Bearer ".length);
  return null;
};

export const requireUser = fp<{ optional?: boolean }>(async (app, opts) => {
  app.addHook("onRequest", async (req: FastifyRequest, reply: FastifyReply) => {
    const token = bearer(req);
    if (token) {
      req.user = { id: token };
    } else if (req.headers["x-gsw-user-id"]) {
      req.user = { id: String(req.headers["x-gsw-user-id"]) };
    } else if (config.dev.userId) {
      req.user = { id: config.dev.userId };
    }

    if (!opts.optional && !req.user) {
      return reply.code(401).send({ error: "unauthorized" });
    }
  });
});

export const requireAdmin = async (req: FastifyRequest): Promise<void> => {
  if (!req.user) throw unauthorized();
  if (!config.dev.adminUserIds.has(req.user.id)) throw forbidden();
};