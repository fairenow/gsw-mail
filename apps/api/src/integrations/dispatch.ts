import { and, eq } from "drizzle-orm";
import { findStoredStalwartMailboxToken } from "../auth/storedStalwartToken.js";
import { refreshStoredStalwartMailboxToken } from "../auth/refreshStalwartMailboxToken.js";
import { config } from "../config.js";
import { db } from "../db/client.js";
import { integrationEmails } from "../db/integrationSchema.js";
import { deliverySuppressions, emailAccounts, mailAccountMemberships, outboundMessages, users } from "../db/schema.js";
import { getEngine } from "../engine/index.js";
import type { OutboundJob } from "../outbound/types.js";
import { integrationService } from "./service.js";
import { IntegrationError } from "./contract.js";

export async function assertIntegrationDispatch(job: OutboundJob, database = db, service = integrationService, liveTransportReady = () => config.mailEngine !== "demo" && config.outbound.relay === "stalwart"): Promise<boolean> {
  const [request] = await database.select().from(integrationEmails).where(eq(integrationEmails.outboundMessageId, job.id)).limit(1);
  if (!request) return false;
  const principal = { installationId: request.installationId, keyId: request.keyId, scopes: [] };
  await service.validateKey(principal, "email.send");
  const row = await service.installation(request.installationId);
  if (request.testMode || row.installation.testMode || !liveTransportReady()) throw new IntegrationError(403, "live_transport_unavailable");
  if (row.account.id !== job.accountId || row.account.address !== job.fromAddress) throw new IntegrationError(403, "dispatch_not_allowed");
  const suppressed = await database.select({ email: deliverySuppressions.email }).from(deliverySuppressions).where(eq(deliverySuppressions.organizationId, row.installation.organizationId));
  if (suppressed.some(r => job.to.includes(r.email))) throw new IntegrationError(403, "recipient_suppressed");
  return true;
}

export async function prepareIntegrationDispatch(job: OutboundJob): Promise<void> {
  const [identity] = await db.select({ productUserId: users.id, authUserId: users.authUserId })
    .from(emailAccounts).innerJoin(users, eq(emailAccounts.userId, users.id))
    .innerJoin(mailAccountMemberships, and(eq(mailAccountMemberships.accountId, emailAccounts.id), eq(mailAccountMemberships.userId, users.id), eq(mailAccountMemberships.authUserId, users.authUserId)))
    .where(and(eq(emailAccounts.id, job.accountId), eq(users.status, "active"), eq(mailAccountMemberships.role, "owner"))).limit(1);
  if (!identity?.authUserId) throw new IntegrationError(403, "mailbox_authorization_required");
  const context = { productUserId: identity.productUserId, authUserId: identity.authUserId, accountId: job.accountId };
  const token = await findStoredStalwartMailboxToken(context) ?? await refreshStoredStalwartMailboxToken(context);
  if (!token) throw new IntegrationError(403, "mailbox_reconnect_required");
  const engine = getEngine(token);
  const [outbound] = await db.select({ engineMessageId: outboundMessages.engineMessageId }).from(outboundMessages).where(eq(outboundMessages.id, job.id)).limit(1);
  if (outbound?.engineMessageId) return;
  const existing = job.messageId ? await engine.findMessageByRfcMessageId(job.accountId, job.messageId) : null;
  const saved = existing ?? await engine.saveSent(job.accountId, { from: job.fromAddress, to: job.to, subject: job.subject, textBody: job.textBody, htmlBody: job.htmlBody, replyTo: job.replyTo, messageId: job.messageId });
  await db.update(outboundMessages).set({ engineMessageId: saved.engineMessageId, engineThreadId: "threadId" in saved ? saved.threadId : saved.engineThreadId }).where(eq(outboundMessages.id, job.id));
}
