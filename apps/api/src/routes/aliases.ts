import { and, eq, inArray } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getAccessibleAccounts, requireOrgPermission } from "../auth/authorize.js";
import { requireUser } from "../auth/middleware.js";
import { db } from "../db/client.js";
import { aliases, domains, emailAccounts } from "../db/schema.js";
import { audit } from "../lib/audit.js";
import { badRequest, conflict, notFound } from "../lib/errors.js";

const createAliasSchema = z.object({
  organizationId: z.string().uuid(),
  domainId: z.string().uuid(),
  source: z.string().trim().regex(/^[a-z0-9._%+-]+$/i),
  targetAccountId: z.string().uuid(),
});

interface AliasParams {
  id: string;
}

export default async (app: FastifyInstance) => {
  await requireUser(app, { optional: false });

  app.get("/mail/aliases", async (req) => {
    const accounts = await getAccessibleAccounts(req.user!.id);
    const accountIds = accounts.map((a) => a.id);
    const rows =
      accountIds.length === 0
        ? []
        : await db
            .select({ id: aliases.id, domainId: aliases.domainId, source: aliases.source, targetAccountId: aliases.targetAccountId })
            .from(aliases)
            .where(inArray(aliases.targetAccountId, accountIds))
            .orderBy(aliases.source);
    return { aliases: rows };
  });

  app.post("/mail/aliases", async (req, reply) => {
    const input = createAliasSchema.parse(req.body);
    await requireOrgPermission(req.user!.id, input.organizationId, ["owner", "admin"]);

    const [target] = await db
      .select({ id: emailAccounts.id, address: emailAccounts.address, organizationId: domains.organizationId })
      .from(emailAccounts)
      .innerJoin(domains, eq(emailAccounts.domainId, domains.id))
      .where(eq(emailAccounts.id, input.targetAccountId))
      .limit(1);
    if (!target) throw notFound("target account not found");

    const [domain] = await db
      .select({ id: domains.id, name: domains.name, organizationId: domains.organizationId })
      .from(domains)
      .where(eq(domains.id, input.domainId))
      .limit(1);
    if (!domain) throw notFound("domain not found");
    if (domain.organizationId !== input.organizationId || domain.organizationId !== target.organizationId) throw badRequest("domain and target account must be in the same organization");
    await requireOrgPermission(req.user!.id, target.organizationId, ["owner", "admin"]);

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
    if (!created) throw new Error("failed to create alias");
    await audit({
      actorUserId: req.user!.id,
      organizationId: target.organizationId,
      action: "alias.created",
      resourceType: "alias",
      resourceId: created.id,
      metadata: { address: `${input.source}@${domain.name}` },
      request: req,
    });
    reply.code(201);
    return { alias: created, resolvesTo: target.address };
  });

  app.delete<{ Params: AliasParams }>("/mail/aliases/:id", async (req) => {
    const { organizationId } = z.object({ organizationId: z.string().uuid() }).parse(req.query);
    await requireOrgPermission(req.user!.id, organizationId, ["owner", "admin"]);
    const [row] = await db
      .select({ id: aliases.id, source: aliases.source, domainName: domains.name, organizationId: domains.organizationId })
      .from(aliases)
      .innerJoin(domains, eq(aliases.domainId, domains.id))
      .where(and(eq(aliases.id, req.params.id), eq(domains.organizationId, organizationId)))
      .limit(1);
    if (!row) throw notFound("alias not found");
    await requireOrgPermission(req.user!.id, row.organizationId, ["owner", "admin"]);
    await db.delete(aliases).where(eq(aliases.id, req.params.id));
    await audit({
      actorUserId: req.user!.id,
      organizationId: row.organizationId,
      action: "alias.deleted",
      resourceType: "alias",
      resourceId: req.params.id,
      metadata: { address: `${row.source}@${row.domainName}` },
      request: req,
    });
    return { id: req.params.id, deleted: true };
  });
};