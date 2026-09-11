import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { z } from "zod";
import { requireAdmin, requireUser } from "../auth/middleware.js";
import { db } from "../db/client.js";
import { aliases, emailAccounts } from "../db/schema.js";
import { conflict, notFound } from "../lib/errors.js";

const createAliasSchema = z.object({
  domainId: z.string().uuid(),
  source: z.string().trim().regex(/^[a-z0-9._%+-]+$/i),
  targetAccountId: z.string().uuid(),
});

export default fp(async (app: FastifyInstance) => {
  app.register(requireUser, { optional: false });

  app.get("/mail/aliases", async (_req, reply) => {
    const rows = await db.select().from(aliases);
    return reply.code(200).send({ aliases: rows });
  });

  app.post("/mail/aliases", { preHandler: requireAdmin }, async (req, reply) => {
    const input = createAliasSchema.parse(req.body);

    const [account] = await db
      .select({ id: emailAccounts.id, address: emailAccounts.address })
      .from(emailAccounts)
      .where(eq(emailAccounts.id, input.targetAccountId))
      .limit(1);
    if (!account) throw notFound("target account not found");

    const [existing] = await db
      .select({ id: aliases.id })
      .from(aliases)
      .where(and(eq(aliases.domainId, input.domainId), eq(aliases.source, input.source)))
      .limit(1);
    if (existing) throw conflict("alias already exists");

    const [created] = await db
      .insert(aliases)
      .values({ domainId: input.domainId, source: input.source, targetAccountId: input.targetAccountId })
      .returning();
    reply.code(201);
    return { alias: created, resolvesTo: account.address };
  });
});