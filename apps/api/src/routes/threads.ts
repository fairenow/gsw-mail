import type { FastifyInstance } from "fastify";
import { requireAccountPermission } from "../auth/authorize.js";
import { requireUser } from "../auth/middleware.js";
import { getUserEngine } from "../engine/index.js";
import { badRequest, notFound } from "../lib/errors.js";

interface Params {
  threadId: string;
}

interface Query {
  accountId?: string;
}

export default async (app: FastifyInstance) => {
  await requireUser(app, { optional: false });

  app.get<{ Params: Params; Querystring: Query }>("/mail/threads/:threadId", async (req) => {
    const { params, query, user } = req;
    if (!query.accountId) throw badRequest("accountId is required");
    await requireAccountPermission(user!.id, query.accountId, "read");
    const engine = await getUserEngine({ productUserId: user!.id, authUserId: req.authUserId ?? user!.id, accountId: query.accountId, headers: req.headers as Record<string, string> });
    const messages = await engine.getThread(query.accountId, params.threadId);
    if (messages.length === 0) throw notFound("thread not found");
    return { threadId: params.threadId, messages };
  });
};
