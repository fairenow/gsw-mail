import { getUserEngine } from "../engine/index.js";
import { getAiCapabilitySettings } from "../ai/capabilities.js";
import { getAiProvider } from "../ai/providers/index.js";
import { HttpError } from "../lib/errors.js";
import { integrationService } from "../integrations/service.js";
import { findStoredStalwartMailboxToken } from "../auth/storedStalwartToken.js";
import { refreshStoredStalwartMailboxToken } from "../auth/refreshStalwartMailboxToken.js";
import { and, desc, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireOrgPermission } from "../auth/authorize.js";
import { requireUser } from "../auth/middleware.js";
import { db } from "../db/client.js";
import { integrationEmails, integrationInstallations, integrationKeys } from "../db/integrationSchema.js";
import { aiIdempotencyKeys, auditEvents, domains, emailAccounts, outboundMessages } from "../db/schema.js";
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
  app.get("/api/admin/integrations/docs", async (_req, reply) => reply.redirect("https://mail-docs.guidedstepswellness.com"));
  app.post("/api/admin/integrations/diagnostics", { config: { rateLimit: { max: 3, timeWindow: "1 minute" } } }, async req => {
    const input = z.object({ organizationId: uuid, accountId: uuid }).strict().parse(req.body);
    await requireOrgPermission(req.user!.id, input.organizationId, ["owner", "admin"]);
    const [account] = await db.select().from(emailAccounts).where(and(eq(emailAccounts.id, input.accountId), eq(emailAccounts.workspaceId, input.organizationId))).limit(1);
    if (!account) throw notFound("mailbox not found in this workspace");
    const checks: { name: string; ok: boolean; detail: string }[] = [];
    let ctx: Awaited<ReturnType<typeof integrationService.mailboxContext>> | undefined;
    try {
      ctx = await integrationService.mailboxContext(account.id);
      const engine = await getUserEngine({ productUserId: ctx.userId, authUserId: ctx.authUserId, accountId: account.id, headers: {}, permission: "read" });
      const messages = await engine.listMessages(account.id, { limit: 1 });
      checks.push({ name: "Live mailbox read", ok: true, detail: `Read succeeded (${messages.length} sample records); message content is not included.` });
    } catch {
      checks.push({ name: "Live mailbox read", ok: false, detail: "Mailbox authorization or read failed. Reconnect the mailbox and review server logs." });
    }
    const verifyProvider = async (provider: string, name: string) => {
      try {
        const result = await getAiProvider(provider).run({ messages: [{ role: "user", content: "Reply with OK. This is a service connectivity check. Do not use tools." }] });
        checks.push({ name, ok: Boolean(result.content), detail: result.content ? `Provider responded using ${result.model}.` : "Provider returned no text." });
      } catch (error) {
        checks.push({ name, ok: false, detail: error instanceof HttpError ? `Provider check failed (HTTP ${error.status}). Check its configuration and account availability.` : "Provider check failed. Review server logs." });
      }
    };
    let selectedProvider: string | undefined;
    if (ctx) {
      const settings = await getAiCapabilitySettings(ctx.userId);
      selectedProvider = settings.modelProvider;
      if (settings.enabled) await verifyProvider(selectedProvider, "Selected mailbox AI");
      else checks.push({ name: "Selected mailbox AI", ok: false, detail: "AI is disabled for this mailbox." });
    }
    if (selectedProvider !== "kimi" || !checks.some(check => check.name === "Selected mailbox AI" && check.ok)) await verifyProvider("kimi", "Kimi provider");
    await db.insert(auditEvents).values({ organizationId: input.organizationId, actorUserId: req.user!.id, action: "integration.diagnostics", resourceType: "email_account", resourceId: account.id });
    return { checkedAt: new Date().toISOString(), accountId: account.id, checks, coverage: "Live service diagnostics only. No external key created, no email sent. Bearer-key requests and recipient delivery need separate verification." };
  });
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
    const [usage] = await db.select({ emails: sql<number>`count(*)` }).from(integrationEmails).where(eq(integrationEmails.installationId, row.id));
    const emails = await db.select({ id: integrationEmails.id, createdAt: integrationEmails.createdAt, testMode: integrationEmails.testMode, status: outboundMessages.transportStatus, failureCode: outboundMessages.failureCode }).from(integrationEmails).leftJoin(outboundMessages, eq(integrationEmails.outboundMessageId, outboundMessages.id)).where(eq(integrationEmails.installationId, row.id)).orderBy(desc(integrationEmails.createdAt)).limit(20);
    const operations = await db.select({ name: aiIdempotencyKeys.toolName, status: aiIdempotencyKeys.status, createdAt: aiIdempotencyKeys.createdAt }).from(aiIdempotencyKeys).where(sql`${aiIdempotencyKeys.key} LIKE ${`api:${row.id}:%`}`).orderBy(desc(aiIdempotencyKeys.createdAt)).limit(20);
    return { health, acceptedEmails: Number(usage?.emails ?? 0), recentEmails: emails, recentOperations: operations };
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
