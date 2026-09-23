import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser } from "../auth/middleware.js";
import { getUserMessageChanges } from "../engine/index.js";

const querySchema = z.object({
  accountId: z.string().uuid(),
  sinceState: z.string().min(1).optional(),
});

export default async (app: FastifyInstance) => {
  await requireUser(app, { optional: false });

  app.get("/mail/changes", async (req) => {
    const query = querySchema.parse(req.query);
    return getUserMessageChanges({
      productUserId: req.user!.id,
      authUserId: req.authUserId ?? req.user!.id,
      accountId: query.accountId,
      headers: req.headers as Record<string, string>,
      sinceState: query.sinceState,
    });
  });
};
