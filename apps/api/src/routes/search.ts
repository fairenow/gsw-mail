import type { FastifyInstance } from "fastify";
import { requireUser } from "../auth/middleware.js";
import { badRequest } from "../lib/errors.js";
import { createMailService } from "../services/mailService.js";

interface Query {
  q: string;
  accountId?: string;
  mailbox?: string;
}

export default async (app: FastifyInstance) => {
  await requireUser(app, { optional: false });

  app.get<{ Querystring: Query }>("/mail/search", async (req) => {
    const { query, user } = req;
    if (!query.q?.trim()) throw badRequest("q is required");
    if (!query.accountId) throw badRequest("accountId is required");
    const mail = createMailService({
      userId: user!.id,
      authUserId: req.authUserId ?? user!.id,
      headers: req.headers as Record<string, string>,
    });
    const messages = await mail.search(query.accountId, query.q.trim(), query.mailbox);
    return { messages };
  });
};
