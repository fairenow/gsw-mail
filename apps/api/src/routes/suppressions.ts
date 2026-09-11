import { desc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { z } from "zod";
import { resolveAdminOrg } from "../auth/authorize.js";
import { requireUser } from "../auth/middleware.js";
import { db } from "../db/client.js";
import { deliverySuppressions, suppressionReason } from "../db/schema.js";
import { audit } from "../lib/audit.js";
import { badRequest, conflict, notFound } from "../lib/errors.js";

const listSchema = z.object({
  organizationId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const createSchema = z.object({
  email: z.string().email(),
  organizationId: z.string().uuid().optional(),
  reason: z.enum(suppressionReason.enumValues),
});

interface Params {
  id: string;
}

export default fp(async (app: FastifyInstance) => {
  app.register(requireUser, { optional: false });

  app.get("/admin/suppressions", async (req, reply) => {
    const input = listSchema.parse(req.query ?? {});
    const organizationId = await resolveAdminOrg(req.user!.id, input.organizationId);
    const rows = await db
      .select({
        id: deliverySuppressions.id,
        email: deliverySuppressions.email,
        reason: deliverySuppressions.reason,
        source: deliverySuppressions.source,
        createdAt: deliverySuppressions.createdAt,
      })
      .from(deliverySuppressions)
      .where(eq(deliverySuppressions.organizationId, organizationId))
      .orderBy(desc(deliverySuppressions.createdAt))
      .limit(input.limit ?? 100)
      .offset(input.offset ?? 0);
    return reply.code(200).send({ organizationId, suppressions: rows });
  });

  app.post("/admin/suppressions", async (req, reply) => {
    const input = createSchema.parse(req.body);
    const organizationId = await resolveAdminOrg(req.user!.id, input.organizationId);
    const email = input.email.toLowerCase();
    const [created] = await db
      .insert(deliverySuppressions)
      .values({ organizationId, email, reason: input.reason, source: "manual" })
      .onConflictDoNothing({ target: [deliverySuppressions.organizationId, deliverySuppressions.email] })
      .returning();
    if (!created) throw conflict("email is already suppressed for this organization");
    await audit({
      actorUserId: req.user!.id,
      organizationId,
      action: "suppression.added",
      resourceType: "delivery_suppression",
      resourceId: created.id,
      metadata: { email, reason: input.reason },
      request: req,
    });
    return reply.code(201).send({ suppression: created });
  });

  app.delete<{ Params: Params }>("/admin/suppressions/:id", async (req, reply) => {
    const [row] = await db
      .select({ id: deliverySuppressions.id, organizationId: deliverySuppressions.organizationId, email: deliverySuppressions.email })
      .from(deliverySuppressions)
      .where(eq(deliverySuppressions.id, req.params.id))
      .limit(1);
    if (!row) throw notFound("suppression not found");
    const organizationId = await resolveAdminOrg(req.user!.id, row.organizationId);
    if (organizationId !== row.organizationId) throw badRequest("you do not administer this suppression's organization");
    await db.delete(deliverySuppressions).where(eq(deliverySuppressions.id, row.id));
    await audit({
      actorUserId: req.user!.id,
      organizationId,
      action: "suppression.removed",
      resourceType: "delivery_suppression",
      resourceId: row.id,
      metadata: { email: row.email },
      request: req,
    });
    return reply.code(200).send({ id: row.id, removed: true });
  });
});