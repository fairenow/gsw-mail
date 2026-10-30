import { and, desc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireOrgPermission } from "../auth/authorize.js";
import { requireUser } from "../auth/middleware.js";
import { db } from "../db/client.js";
import { integrationInstallations, integrationKeys } from "../db/integrationSchema.js";
import { auditEvents, domains, emailAccounts } from "../db/schema.js";
import { badRequest, notFound } from "../lib/errors.js";
import { installationSchema, issueIntegrationKey, keySchema } from "../integrations/contract.js";

const uuid = z.string().uuid();
export default async function integrationAdmin(app: FastifyInstance) {
  await requireUser(app, { optional: false });
  app.addHook("onRequest", async (_req, reply) => { reply.header("Cache-Control", "no-store"); });
  async function requireInstallation(userId: string, id: string) {
    const [row] = await db.select().from(integrationInstallations).where(eq(integrationInstallations.id, uuid.parse(id))).limit(1);
    if (!row) throw notFound("installation not found");
    await requireOrgPermission(userId, row.organizationId, ["owner", "admin"]);
    return row;
  }
  app.post("/api/admin/integrations", async (req, reply) => {
    const input = installationSchema.parse(req.body);
    await requireOrgPermission(req.user!.id, input.organizationId, ["owner", "admin"]);
    const [sender] = await db.select({ account: emailAccounts, domain: domains }).from(emailAccounts).innerJoin(domains, eq(emailAccounts.domainId, domains.id))
      .where(and(eq(emailAccounts.id, input.accountId), eq(emailAccounts.workspaceId, input.organizationId), eq(domains.organizationId, input.organizationId))).limit(1);
    if (!sender || sender.account.status !== "active" || sender.account.authSetupStatus !== "ready" || sender.domain.status !== "verified") throw badRequest("select an active mailbox on a verified workspace domain");
    if (!input.testMode && [sender.domain.spfStatus, sender.domain.dkimStatus, sender.domain.dmarcStatus].some(s => s !== "verified")) throw badRequest("live sender DNS must be verified");
    const result = await db.transaction(async tx => {
      const [row] = await tx.insert(integrationInstallations).values({ ...input, authorizedBy: req.user!.id }).returning();
      await tx.insert(auditEvents).values({ organizationId: input.organizationId, actorUserId: req.user!.id, action: "integration.created", resourceType: "integration_installation", resourceId: row!.id });
      return row!;
    });
    return reply.code(201).send(result);
  });
  app.get<{ Querystring: { organizationId: string } }>("/api/admin/integrations", async req => {
    const organizationId = uuid.parse(req.query.organizationId);
    await requireOrgPermission(req.user!.id, organizationId, ["owner", "admin"]);
    return { installations: await db.select().from(integrationInstallations).where(eq(integrationInstallations.organizationId, organizationId)).orderBy(desc(integrationInstallations.createdAt)) };
  });
  app.patch<{ Params: { id: string } }>("/api/admin/integrations/:id", async req => {
    const installation = await requireInstallation(req.user!.id, req.params.id);
    const input = z.object({ active: z.boolean() }).strict().parse(req.body);
    return db.transaction(async tx => {
      await tx.select({ id: integrationInstallations.id }).from(integrationInstallations).where(eq(integrationInstallations.id, installation.id)).for("update");
      const [row] = await tx.update(integrationInstallations).set(input).where(eq(integrationInstallations.id, installation.id)).returning();
      await tx.insert(auditEvents).values({ organizationId: installation.organizationId, actorUserId: req.user!.id, action: input.active ? "integration.resumed" : "integration.paused", resourceType: "integration_installation", resourceId: installation.id });
      return row;
    });
  });
  app.post<{ Params: { id: string } }>("/api/admin/integrations/:id/keys", async (req, reply) => {
    const installation = await requireInstallation(req.user!.id, req.params.id);
    const input = keySchema.parse(req.body);
    const issued = issueIntegrationKey();
    const expiresAt = new Date(Date.now() + input.expiresInDays * 86400_000);
    const key = await db.transaction(async tx => {
      const [row] = await tx.insert(integrationKeys).values({ installationId: installation.id, name: input.name, scopes: input.scopes, keyHash: issued.keyHash, keyPrefix: issued.keyPrefix, expiresAt }).returning({ id: integrationKeys.id, name: integrationKeys.name, scopes: integrationKeys.scopes, expiresAt: integrationKeys.expiresAt });
      await tx.insert(auditEvents).values({ organizationId: installation.organizationId, actorUserId: req.user!.id, action: "integration.key.created", resourceType: "integration_key", resourceId: row!.id });
      return row!;
    });
    return reply.code(201).send({ ...key, secret: issued.secret });
  });
  app.get<{ Params: { id: string } }>("/api/admin/integrations/:id/keys", async req => {
    const installation = await requireInstallation(req.user!.id, req.params.id);
    return { keys: await db.select({ id: integrationKeys.id, name: integrationKeys.name, prefix: integrationKeys.keyPrefix, scopes: integrationKeys.scopes, expiresAt: integrationKeys.expiresAt, revokedAt: integrationKeys.revokedAt, createdAt: integrationKeys.createdAt }).from(integrationKeys).where(eq(integrationKeys.installationId, installation.id)) };
  });
  app.delete<{ Params: { id: string; keyId: string } }>("/api/admin/integrations/:id/keys/:keyId", async req => {
    const installation = await requireInstallation(req.user!.id, req.params.id);
    return db.transaction(async tx => {
      await tx.select({ id: integrationInstallations.id }).from(integrationInstallations).where(eq(integrationInstallations.id, installation.id)).for("update");
      const [key] = await tx.update(integrationKeys).set({ revokedAt: new Date() }).where(and(eq(integrationKeys.id, uuid.parse(req.params.keyId)), eq(integrationKeys.installationId, installation.id))).returning({ id: integrationKeys.id });
      if (!key) throw notFound("key not found");
      await tx.insert(auditEvents).values({ organizationId: installation.organizationId, actorUserId: req.user!.id, action: "integration.key.revoked", resourceType: "integration_key", resourceId: key.id });
      return { revoked: true };
    });
  });
}
