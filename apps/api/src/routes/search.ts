import type { FastifyInstance } from "fastify";
import { requireAccountPermission } from "../auth/authorize.js";
import { requireUser } from "../auth/middleware.js";
import { getEngine } from "../engine/index.js";
import { badRequest } from "../lib/errors.js";

interface Query {
  q: string;
  accountId?: string;
  mailbox?: string;
}

export default async (app: FastifyInstance) => {
  await requireUser(app, { optional: false });
  const engine = getEngine();

  app.get<{ Querystring: Query }>("/mail/search", async ({ query, user }) => {
    if (!query.q?.trim()) throw badRequest("q is required");
    if (!query.accountId) throw badRequest("accountId is required");
    await requireAccountPermission(user!.id, query.accountId, "read");
    const messages = await engine.search(query.accountId, query.q.trim(), query.mailbox);
    return { messages };
  });
};