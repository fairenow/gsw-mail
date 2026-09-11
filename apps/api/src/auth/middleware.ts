import { timingSafeEqual } from "node:crypto";
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

const safeEqual = (a: string, b: string): boolean => {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
};

export const requireUser = fp<{ optional?: boolean }>(async (app, opts) => {
  app.addHook("onRequest", async (req: FastifyRequest, reply: FastifyReply) => {
    if (config.env === "production") {
      const token = bearer(req);
      if (token && (safeEqual(token, config.auth.userToken) || safeEqual(token, config.auth.adminToken))) {
        req.user = { id: config.auth.userId };
      }
    } else {
      const token = bearer(req);
      if (token) {
        req.user = { id: token };
      } else if (req.headers["x-gsw-user-id"]) {
        req.user = { id: String(req.headers["x-gsw-user-id"]) };
      } else if (config.dev.userId) {
        req.user = { id: config.dev.userId };
      }
    }

    if (!opts.optional && !req.user) {
      return reply.code(401).send({ error: "unauthorized" });
    }
  });
});

export const requireAdmin = async (req: FastifyRequest): Promise<void> => {
  if (!req.user) throw unauthorized();
  if (config.env === "production") {
    const token = bearer(req);
    if (!token || !safeEqual(token, config.auth.adminToken)) throw forbidden();
    return;
  }
  if (!config.dev.adminUserIds.has(req.user.id)) throw forbidden();
};