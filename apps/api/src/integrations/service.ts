import { randomUUID } from "node:crypto";
import { and, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { integrationEmails, integrationInstallations, integrationKeys } from "../db/integrationSchema.js";
import { deliverySuppressions, domains, emailAccounts, mailAccountMemberships, authUsers, outboundMessages, outboundRecipients, users } from "../db/schema.js";
import { config } from "../config.js";
import { fingerprint, hashKey, IntegrationError } from "./contract.js";
import type { AgentExecutionContext } from "../ai/tools/types.js";
import type { IntegrationSend } from "./contract.js";

type Database = typeof db;
export type IntegrationPrincipal = { installationId: string; keyId: string; scopes: string[] };

export function createIntegrationService(database: Database = db, options = { liveTransportReady: () => config.mailEngine !== "demo" && config.outbound.relay === "stalwart" }) {
  async function installation(id: string, source: Database = database) {
    const [row] = await source.select({ installation: integrationInstallations, account: emailAccounts, domain: domains })
      .from(integrationInstallations)
      .innerJoin(emailAccounts, eq(integrationInstallations.accountId, emailAccounts.id))
      .innerJoin(domains, eq(emailAccounts.domainId, domains.id))
      .where(eq(integrationInstallations.id, id)).limit(1);
    if (!row || !row.installation.active || row.account.workspaceId !== row.installation.organizationId || row.domain.organizationId !== row.installation.organizationId) throw new IntegrationError(403, "installation_unavailable");
    if (row.account.status !== "active" || row.account.authSetupStatus !== "ready" || row.domain.status !== "verified") throw new IntegrationError(403, "sender_unavailable");
    if (!row.installation.testMode && (row.domain.spfStatus !== "verified" || row.domain.dkimStatus !== "verified" || row.domain.dmarcStatus !== "verified")) throw new IntegrationError(403, "sender_dns_not_ready");
    return row;
  }

  async function validateKey(principal: IntegrationPrincipal, scope: string, source: Database = database) {
    const [key] = await source.select().from(integrationKeys).where(and(eq(integrationKeys.id, principal.keyId), eq(integrationKeys.installationId, principal.installationId), isNull(integrationKeys.revokedAt))).limit(1);
    if (!key || key.expiresAt <= new Date()) throw new IntegrationError(401, "invalid_api_key");

  }

  async function authenticate(authorization: string | undefined): Promise<IntegrationPrincipal> {
    const token = authorization?.match(/^Bearer (gsw_int_[a-f0-9]{64})$/)?.[1];
    if (!token) throw new IntegrationError(401, "invalid_api_key");
    const [key] = await database.select().from(integrationKeys).where(eq(integrationKeys.keyHash, hashKey(token))).limit(1);
    if (!key || key.revokedAt || key.expiresAt <= new Date()) throw new IntegrationError(401, "invalid_api_key");
    const principal = { installationId: key.installationId, keyId: key.id, scopes: ["mailbox.full"] };
    await installation(key.installationId);
    return principal;
  }

  async function connection(principal: IntegrationPrincipal) {
    await validateKey(principal, "connection.read");
    const row = await installation(principal.installationId);
    return { id: row.installation.id, name: row.installation.name, testMode: row.installation.testMode, scopes: principal.scopes, sender: { id: row.account.id, address: row.account.address }, access: "mailbox.full", dailyLimit: row.installation.dailyLimit };
  }

  async function submit(principal: IntegrationPrincipal, input: IntegrationSend, idempotencyKey: string) {
    return database.transaction(async tx => {
      const source = tx as unknown as Database;
      await tx.select({ id: integrationInstallations.id }).from(integrationInstallations).where(eq(integrationInstallations.id, principal.installationId)).for("update");
      await validateKey(principal, "email.send", source);
      const row = await installation(principal.installationId, source);
      const requestFingerprint = fingerprint(input);
      const [existing] = await tx.select().from(integrationEmails).where(and(eq(integrationEmails.installationId, principal.installationId), eq(integrationEmails.idempotencyKey, idempotencyKey))).limit(1);
      if (existing) {
        if (existing.fingerprint !== requestFingerprint) throw new IntegrationError(409, "idempotency_conflict");
        return { id: existing.id, testMode: existing.testMode, idempotentReplay: true };
      }
      if (input.senderId !== row.account.id) throw new IntegrationError(403, "sender_not_allowed");
      const suppressed = await tx.select({ email: deliverySuppressions.email }).from(deliverySuppressions).where(and(eq(deliverySuppressions.organizationId, row.installation.organizationId), inArray(deliverySuppressions.email, input.to))).limit(1);
      if (suppressed.length) throw new IntegrationError(409, "recipient_suppressed");
      const [usage] = await tx.select({ count: sql<number>`count(*)` }).from(integrationEmails).where(and(eq(integrationEmails.installationId, row.installation.id), gte(integrationEmails.createdAt, sql`date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`)));
      if (Number(usage?.count ?? 0) >= row.installation.dailyLimit) throw new IntegrationError(429, "daily_limit_reached", true);
      if (!row.installation.testMode && !options.liveTransportReady()) throw new IntegrationError(503, "live_transport_unavailable", true);
      await tx.select({ id: emailAccounts.id }).from(emailAccounts).where(eq(emailAccounts.id, row.account.id)).for("update");
      const [rate] = await tx.select({ count: sql<number>`count(*)` }).from(outboundMessages).where(and(eq(outboundMessages.accountId, row.account.id), gte(outboundMessages.createdAt, sql`now() - interval '1 hour'`)));
      if (!row.installation.testMode && Number(rate?.count ?? 0) >= config.send.perHour) throw new IntegrationError(429, "sender_rate_limit", true);
      const [minuteRate] = await tx.select({ count: sql<number>`count(*)` }).from(outboundMessages).where(and(eq(outboundMessages.accountId, row.account.id), gte(outboundMessages.createdAt, sql`now() - interval '1 minute'`)));
      if (!row.installation.testMode && Number(minuteRate?.count ?? 0) >= config.send.perMinute) throw new IntegrationError(429, "sender_rate_limit", true);
      let outboundId: string | null = null;
      if (!row.installation.testMode) {
        const [outbound] = await tx.insert(outboundMessages).values({ accountId: row.account.id, transportStatus: "queued", fromAddress: row.account.address, to: input.to, subject: input.subject, textBody: input.text, htmlBody: input.html, replyTo: input.replyTo, templateKey: "none", messageId: `${randomUUID()}@${row.account.address.split("@")[1]}`, nextAttemptAt: new Date() }).returning({ id: outboundMessages.id });
        outboundId = outbound!.id;
        await tx.insert(outboundRecipients).values([...new Set(input.to)].map(email => ({ outboundMessageId: outboundId!, email, recipientType: "to" as const })));
      }
      const [request] = await tx.insert(integrationEmails).values({ installationId: row.installation.id, keyId: principal.keyId, outboundMessageId: outboundId, idempotencyKey, fingerprint: requestFingerprint, testMode: row.installation.testMode, metadata: input.metadata }).returning({ id: integrationEmails.id });
      return { id: request!.id, testMode: row.installation.testMode, idempotentReplay: false };
    });
  }

  async function status(principal: IntegrationPrincipal, id: string) {
    await validateKey(principal, "email.read");
    await installation(principal.installationId);
    const [row] = await database.select({ email: integrationEmails, transportStatus: outboundMessages.transportStatus, deliveryStatus: outboundMessages.deliveryStatus, failureCode: outboundMessages.failureCode, acceptedAt: outboundMessages.acceptedAt, deliveredAt: outboundMessages.deliveredAt })
      .from(integrationEmails).leftJoin(outboundMessages, eq(integrationEmails.outboundMessageId, outboundMessages.id))
      .where(and(eq(integrationEmails.id, id), eq(integrationEmails.installationId, principal.installationId))).limit(1);
    if (!row) throw new IntegrationError(404, "email_not_found");
    return { id: row.email.id, testMode: row.email.testMode, status: row.email.testMode ? "simulated" : row.transportStatus === "accepted" ? "submitted" : row.transportStatus, deliveryStatus: row.email.testMode ? "not_sent" : row.deliveryStatus, failureCode: row.failureCode, submittedAt: row.acceptedAt, deliveredAt: row.deliveredAt, metadata: row.email.metadata, createdAt: row.email.createdAt };
  }

  async function context(principal: IntegrationPrincipal): Promise<AgentExecutionContext> {
    await validateKey(principal, "mailbox.full");
    const row = await installation(principal.installationId);
    return mailboxContext(row.account.id);
  }
  async function mailboxContext(accountId: string): Promise<AgentExecutionContext> {
    const [owner] = await database.select({ userId: users.id, authUserId: users.authUserId, email: authUsers.email, address: emailAccounts.address }).from(emailAccounts)
      .innerJoin(users, eq(emailAccounts.userId, users.id)).innerJoin(authUsers, eq(users.authUserId, authUsers.id))
      .innerJoin(mailAccountMemberships, and(eq(mailAccountMemberships.accountId, emailAccounts.id), eq(mailAccountMemberships.userId, users.id), eq(mailAccountMemberships.authUserId, users.authUserId)))
      .where(and(eq(emailAccounts.id, accountId), eq(users.status, "active"), eq(mailAccountMemberships.role, "owner"))).limit(1);
    if (!owner?.authUserId || owner.email.toLowerCase() !== owner.address.toLowerCase()) throw new IntegrationError(403, "mailbox_authorization_required");
    return { userId: owner.userId, authUserId: owner.authUserId, accountId: accountId, headers: {} };
  }
  return { authenticate, connection, submit, status, installation, validateKey, context, mailboxContext };
}
export const integrationService = createIntegrationService();
