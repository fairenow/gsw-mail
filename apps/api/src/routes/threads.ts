import type { FastifyInstance } from "fastify";
import { requireAccountPermission } from "../auth/authorize.js";
import { requireUser } from "../auth/middleware.js";
import { getEngine } from "../engine/index.js";
import { badRequest, notFound } from "../lib/errors.js";

interface Params {
  threadId: string;
}

interface Query {
  accountId?: string;
}

export default async (app: FastifyInstance) => {
  await requireUser(app, { optional: false });
  const engine = getEngine();

  app.get<{ Params: Params; Querystring: Query }>("/mail/threads/:threadId", async ({ params, query, user }) => {
    if (!query.accountId) throw badRequest("accountId is required");
    await requireAccountPermission(user!.id, query.accountId, "read");
    const messages = await engine.getThread(query.accountId, params.threadId);
    if (messages.length === 0) throw notFound("thread not found");
    return { threadId: params.threadId, messages };
  });
};