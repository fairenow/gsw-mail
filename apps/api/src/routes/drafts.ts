import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { z } from "zod";
import { requireUser } from "../auth/middleware.js";
import { db } from "../db/client.js";
import { emailAccounts } from "../db/schema.js";
import { getEngine } from "../engine/index.js";
import { badRequest, notFound } from "../lib/errors.js";
import { enqueueOutbound } from "../outbound/queue.js";

const draftSchema = z.object({
  accountId: z.string().uuid(),
  to: z.array(z.string().email()).optional(),
  cc: z.array(z.string().email()).optional(),
  bcc: z.array(z.string().email()).optional(),
  subject: z.string().optional(),
  textBody: z.string().optional(),
  htmlBody: z.string().optional(),
  replyTo: z.string().email().optional(),
});

const sendDraftSchema = z.object({ accountId: z.string().uuid() });

export default fp(async (app: FastifyInstance) => {
  app.register(requireUser, { optional: false });
  const engine = getEngine();

  app.post("/mail/drafts", async (req, reply) => {
    const input = draftSchema.parse(req.body);
    const engineId = await engine.saveDraft(input.accountId, {
      from: "",
      to: input.to ?? [],
      cc: input.cc,
      bcc: input.bcc,
      subject: input.subject,
      textBody: input.textBody,
      htmlBody: input.htmlBody,
      replyTo: input.replyTo,
    });
    reply.code(201);
    return { engineId };
  });

  app.post<{ Params: { id: string } }>("/mail/drafts/:id/send", async (req, reply) => {
    const body = sendDraftSchema.parse(req.body);
    const accountId = body.accountId;
      const [account] = await db
        .select({ id: emailAccounts.id, address: emailAccounts.address, status: emailAccounts.status })
        .from(emailAccounts)
        .where(eq(emailAccounts.id, accountId))
        .limit(1);
      if (!account) throw notFound("account not found");
      if (account.status !== "active") throw badRequest("account is not active");

      const draft = await engine.getMessage(accountId, req.params.id);
      if (!draft) throw notFound("draft not found");

      const sent = await engine.saveSent(accountId, {
        from: account.address,
        to: draft.to.map((a) => a.email),
        cc: draft.cc.map((a) => a.email),
        subject: draft.subject,
        textBody: draft.textBody,
        htmlBody: draft.htmlBody,
      });

      const jobId = await enqueueOutbound({
        accountId,
        fromAddress: account.address,
        to: draft.to.map((a) => a.email),
        cc: draft.cc.map((a) => a.email),
        subject: draft.subject,
        textBody: draft.textBody,
        htmlBody: draft.htmlBody,
        messageId: sent.engineMessageId,
      });

      reply.code(202);
      return { jobId, messageId: sent.engineMessageId, status: "queued" };
    });
});