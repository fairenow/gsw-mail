import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { z } from "zod";
import { getOwnedAccount } from "../auth/authorize.js";
import { requireUser } from "../auth/middleware.js";
import { db } from "../db/client.js";
import { emailAccounts, outboundMessages } from "../db/schema.js";
import { getEngine } from "../engine/index.js";
import { badRequest } from "../lib/errors.js";
import { enqueueOutbound } from "../outbound/queue.js";

const sendSchema = z.object({
  accountId: z.string().uuid(),
  to: z.array(z.string().email({ message: "invalid recipient" })).min(1),
  cc: z.array(z.string().email()).optional(),
  bcc: z.array(z.string().email()).optional(),
  subject: z.string().optional(),
  textBody: z.string().optional(),
  htmlBody: z.string().optional(),
  replyTo: z.string().email().optional(),
  inReplyTo: z.string().optional(),
  references: z.string().optional(),
  clientRequestId: z.string().trim().min(1).max(200).optional(),
});

export default fp(async (app: FastifyInstance) => {
  app.register(requireUser, { optional: false });
  const engine = getEngine();

  app.post("/mail/send", async (req, reply) => {
    const input = sendSchema.parse(req.body);
    await getOwnedAccount(input.accountId, req.user!.id);

    if (input.clientRequestId) {
      const existing = await db
        .select({ id: outboundMessages.id, messageId: outboundMessages.messageId, status: outboundMessages.status })
        .from(outboundMessages)
        .where(eq(outboundMessages.clientRequestId, input.clientRequestId))
        .limit(1);
      const prior = existing[0];
      if (prior) {
        reply.code(202);
        return { jobId: prior.id, messageId: prior.messageId ?? null, status: prior.status, idempotentReplay: true };
      }
    }

    const [account] = await db
      .select({ id: emailAccounts.id, address: emailAccounts.address, status: emailAccounts.status })
      .from(emailAccounts)
      .where(eq(emailAccounts.id, input.accountId))
      .limit(1);
    if (!account) throw badRequest("account not found");
    if (account.status !== "active") throw badRequest("account is not active");

    const sent = await engine.saveSent(account.id, {
      from: account.address,
      to: input.to,
      cc: input.cc,
      bcc: input.bcc,
      subject: input.subject,
      textBody: input.textBody,
      htmlBody: input.htmlBody,
      replyTo: input.replyTo,
      inReplyTo: input.inReplyTo,
      references: input.references,
    });

    const jobId = await enqueueOutbound({
      accountId: account.id,
      fromAddress: account.address,
      to: input.to,
      cc: input.cc,
      bcc: input.bcc,
      subject: input.subject,
      textBody: input.textBody,
      htmlBody: input.htmlBody,
      replyTo: input.replyTo,
      inReplyTo: input.inReplyTo,
      references: input.references,
      messageId: sent.engineMessageId,
      clientRequestId: input.clientRequestId,
    });

    reply.code(202);
    return { jobId, messageId: sent.engineMessageId, threadId: sent.threadId, status: "queued" };
  });
});