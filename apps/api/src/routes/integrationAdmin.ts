import { integrationService } from "../integrations/service.js";
import { findStoredStalwartMailboxToken } from "../auth/storedStalwartToken.js";
import { refreshStoredStalwartMailboxToken } from "../auth/refreshStalwartMailboxToken.js";
import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireOrgPermission } from "../auth/authorize.js";
import { requireUser } from "../auth/middleware.js";
import { db } from "../db/client.js";
import { integrationEmails, integrationInstallations, integrationKeys, integrationWebhookEndpoints } from "../db/integrationSchema.js";
import { aiIdempotencyKeys, auditEvents, domains, emailAccounts, outboundMessages } from "../db/schema.js";
import { badRequest, notFound } from "../lib/errors.js";
import { installationSchema, issueIntegrationKey, keySchema } from "../integrations/contract.js";
import { createWebhookEndpoint, integrationWebhookEventTypes, listWebhookDeliveries, listWebhookEndpoints, removeWebhookEndpoint, retryWebhookDelivery } from "../integrations/customerWebhooks.js";

const uuid = z.string().uuid();
export default async function integrationAdmin(app: FastifyInstance) {
  await requireUser(app, { optional: false });
  app.addHook("onRequest", async (_req, reply) => { reply.header("Cache-Control", "no-store"); });
  async function requireInstallation(userId: string, id: string) {
    const [row] = await db.select().from(integrationInstallations).where(eq(integrationInstallations.id, uuid.parse(id))).limit(1);
    if (!row || row.deletedAt) throw notFound("installation not found");
    await requireOrgPermission(userId, row.organizationId, ["owner", "admin"]);
    return row;
  }
  app.get("/api/admin/integrations/docs", async (_req, reply) => reply.redirect("https://mail-docs.guidedstepswellness.com"));
  app.get<{ Params: { id: string } }>("/api/admin/integrations/:id/service", async req => {
    const row = await requireInstallation(req.user!.id, req.params.id);
    let health = row.active ? "ready" : "paused";
    try {
      await integrationService.installation(row.id);
      if (!row.testMode) {
        const ctx = await integrationService.mailboxContext(row.accountId);
        const principal = { productUserId: ctx.userId, authUserId: ctx.authUserId, accountId: ctx.accountId };
        const token = await findStoredStalwartMailboxToken(principal) ?? await refreshStoredStalwartMailboxToken(principal);
        if (!token) health = "mailbox_reconnect_required";
      }
    } catch { health = row.active ? "mailbox_attention_required" : "paused"; }
    const dayStart = new Date();
    dayStart.setUTCHours(0, 0, 0, 0);
    const [[usage], [today], [keyUsage], [webhookUsage], [operationUsage], [operationToday]] = await Promise.all([
      db.select({ emails: sql<number>`count(*)` }).from(integrationEmails).where(eq(integrationEmails.installationId, row.id)),
      db.select({ emails: sql<number>`count(*)` }).from(integrationEmails).where(and(eq(integrationEmails.installationId, row.id), gte(integrationEmails.createdAt, dayStart))),
      db.select({
        total: sql<number>`count(*)`,
        active: sql<number>`count(*) filter (where ${isNull(integrationKeys.revokedAt)} and ${integrationKeys.expiresAt} > now())`,
        expiringWithin7Days: sql<number>`count(*) filter (where ${isNull(integrationKeys.revokedAt)} and ${integrationKeys.expiresAt} > now() and ${integrationKeys.expiresAt} <= now() + interval '7 days')`,
        nextExpiry: sql<Date | null>`min(${integrationKeys.expiresAt}) filter (where ${isNull(integrationKeys.revokedAt)} and ${integrationKeys.expiresAt} > now())`,
      }).from(integrationKeys).where(eq(integrationKeys.installationId, row.id)),
      db.select({ total: sql<number>`count(*)`, active: sql<number>`count(*) filter (where ${integrationWebhookEndpoints.active} = true)` }).from(integrationWebhookEndpoints).where(eq(integrationWebhookEndpoints.installationId, row.id)),
      db.select({ count: sql<number>`count(*)` }).from(aiIdempotencyKeys).where(sql`${aiIdempotencyKeys.key} LIKE ${`api:${row.id}:%`}`),
      db.select({ count: sql<number>`count(*)` }).from(aiIdempotencyKeys).where(and(sql`${aiIdempotencyKeys.key} LIKE ${`api:${row.id}:%`}`, gte(aiIdempotencyKeys.createdAt, dayStart))),
    ]);
    const emails = await db.select({ id: integrationEmails.id, createdAt: integrationEmails.createdAt, status: outboundMessages.transportStatus, failureCode: outboundMessages.failureCode }).from(integrationEmails).leftJoin(outboundMessages, eq(integrationEmails.outboundMessageId, outboundMessages.id)).where(eq(integrationEmails.installationId, row.id)).orderBy(desc(integrationEmails.createdAt)).limit(20);
    const operations = await db.select({ name: aiIdempotencyKeys.toolName, status: aiIdempotencyKeys.status, createdAt: aiIdempotencyKeys.createdAt }).from(aiIdempotencyKeys).where(sql`${aiIdempotencyKeys.key} LIKE ${`api:${row.id}:%`}`).orderBy(desc(aiIdempotencyKeys.createdAt)).limit(20);
    const todayAccepted = Number(today?.emails ?? 0);
    return {
      health,
      usage: {
        acceptedEmails: Number(usage?.emails ?? 0),
        acceptedToday: todayAccepted,
        operations: Number(operationUsage?.count ?? 0),
        operationsToday: Number(operationToday?.count ?? 0),
        dailyLimit: row.dailyLimit,
        remainingToday: Math.max(0, row.dailyLimit - todayAccepted),
      },
      keys: { total: Number(keyUsage?.total ?? 0), active: Number(keyUsage?.active ?? 0), expiringWithin7Days: Number(keyUsage?.expiringWithin7Days ?? 0), nextExpiry: keyUsage?.nextExpiry ?? null },
      webhooks: { total: Number(webhookUsage?.total ?? 0), active: Number(webhookUsage?.active ?? 0) },
      recentEmails: emails,
      recentOperations: operations,
    };
  });
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
    return { installations: await db.select().from(integrationInstallations).where(and(eq(integrationInstallations.organizationId, organizationId), isNull(integrationInstallations.deletedAt))).orderBy(desc(integrationInstallations.createdAt)) };
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
  app.delete<{ Params: { id: string } }>("/api/admin/integrations/:id", async req => {
    const installation = await requireInstallation(req.user!.id, req.params.id);
    return db.transaction(async tx => {
      await tx.select({ id: integrationInstallations.id }).from(integrationInstallations).where(eq(integrationInstallations.id, installation.id)).for("update");
      await tx.update(integrationKeys).set({ revokedAt: new Date() }).where(and(eq(integrationKeys.installationId, installation.id), isNull(integrationKeys.revokedAt)));
      await tx.update(integrationInstallations).set({ active: false, deletedAt: new Date() }).where(eq(integrationInstallations.id, installation.id));
      await tx.insert(auditEvents).values({ organizationId: installation.organizationId, actorUserId: req.user!.id, action: "integration.removed", resourceType: "integration_installation", resourceId: installation.id });
      return { removed: true };
    });
  });
  app.get<{ Params: { id: string } }>("/api/admin/integrations/:id/webhooks", async req => {
    const installation = await requireInstallation(req.user!.id, req.params.id);
    return { eventTypes: integrationWebhookEventTypes, endpoints: await listWebhookEndpoints(installation.id), deliveries: await listWebhookDeliveries(installation.id) };
  });
  app.post<{ Params: { id: string } }>("/api/admin/integrations/:id/webhooks", async (req, reply) => {
    const installation = await requireInstallation(req.user!.id, req.params.id);
    const input = z.object({
      url: z.string().url().max(2048),
      events: z.array(z.enum(integrationWebhookEventTypes)).min(1).max(integrationWebhookEventTypes.length).default([...integrationWebhookEventTypes]),
    }).strict().parse(req.body);
    const created = await createWebhookEndpoint({ installationId: installation.id, url: input.url, events: input.events });
    await db.insert(auditEvents).values({ organizationId: installation.organizationId, actorUserId: req.user!.id, action: "integration.webhook.created", resourceType: "integration_webhook_endpoint", resourceId: created.endpoint.id });
    return reply.code(201).send({ ...created.endpoint, secret: created.secret });
  });
  app.delete<{ Params: { id: string; webhookId: string } }>("/api/admin/integrations/:id/webhooks/:webhookId", async req => {
    const installation = await requireInstallation(req.user!.id, req.params.id);
    const webhookId = uuid.parse(req.params.webhookId);
    if (!await removeWebhookEndpoint(installation.id, webhookId)) throw notFound("webhook endpoint not found");
    await db.insert(auditEvents).values({ organizationId: installation.organizationId, actorUserId: req.user!.id, action: "integration.webhook.removed", resourceType: "integration_webhook_endpoint", resourceId: webhookId });
    return { removed: true };
  });
  app.post<{ Params: { id: string; deliveryId: string } }>("/api/admin/integrations/:id/webhooks/deliveries/:deliveryId/retry", async req => {
    const installation = await requireInstallation(req.user!.id, req.params.id);
    const deliveryId = uuid.parse(req.params.deliveryId);
    if (!await retryWebhookDelivery(installation.id, deliveryId)) throw notFound("failed webhook delivery not found");
    await db.insert(auditEvents).values({ organizationId: installation.organizationId, actorUserId: req.user!.id, action: "integration.webhook.delivery_retried", resourceType: "integration_webhook_delivery", resourceId: deliveryId });
    return { retrying: true };
  });
  app.post<{ Params: { id: string } }>("/api/admin/integrations/:id/keys", async (req, reply) => {
    const installation = await requireInstallation(req.user!.id, req.params.id);
    const input = keySchema.parse(req.body);
    const issued = issueIntegrationKey();
    const expiresAt = new Date(Date.now() + input.expiresInDays * 86400_000);
    const key = await db.transaction(async tx => {
      const [row] = await tx.insert(integrationKeys).values({ installationId: installation.id, name: input.name, scopes: ["mailbox.full"], keyHash: issued.keyHash, keyPrefix: issued.keyPrefix, expiresAt }).returning({ id: integrationKeys.id, name: integrationKeys.name, scopes: integrationKeys.scopes, expiresAt: integrationKeys.expiresAt });
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
