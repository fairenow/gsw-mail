import type { FastifyInstance } from "fastify";
import { requireUser } from "../auth/middleware.js";
import { badRequest } from "../lib/errors.js";
import { createMailService } from "../services/mailService.js";

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
    const mail = createMailService({
      userId: user!.id,
      authUserId: req.authUserId ?? user!.id,
      headers: req.headers as Record<string, string>,
    });
    const messages = await mail.readThread(query.accountId, params.threadId);
    return { threadId: params.threadId, messages };
  });
};
