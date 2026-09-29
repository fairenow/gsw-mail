import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAccountPermission } from "../auth/authorize.js";
import { requireUser } from "../auth/middleware.js";
import { getStalwartAccessToken } from "../auth/stalwartToken.js";
import { config } from "../config.js";
import { JmapClient, JmapError } from "../engine/jmap.js";
import { submitSend } from "../outbound/sendFlow.js";
import { describeJmapFailure } from "../lib/jmapError.js";

const SEND_BODY_LIMIT = 30 * 1024 * 1024;

const sendSchema = z.object({
  accountId: z.string().uuid(),
  to: z.array(z.string().email({ message: "invalid recipient" })).min(1),
  cc: z.array(z.string().email()).optional(),
  bcc: z.array(z.string().email()).optional(),
  subject: z.string().max(998, { message: "subject too long" }).optional(),
  textBody: z.string().optional(),
  htmlBody: z.string().optional(),
  templateKey: z.string().optional(),
  replyTo: z.string().email().optional(),
  inReplyTo: z.string().optional(),
  references: z.string().optional(),
  mode: z.enum(["new", "reply", "replyAll", "forward"]).optional(),
  attachments: z
    .array(
      z.object({
        filename: z.string().min(1).max(255),
        contentType: z.string().min(1),
        size: z.number().int().nonnegative(),
        contentDisposition: z.enum(["attachment", "inline"]).optional(),
        contentId: z.string().optional(),
        content: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/, { message: "attachment content must be base64" }).optional(),
      }),
    )
    .max(20)
    .optional(),
  clientRequestId: z.string().trim().min(1).max(200).optional(),
});


const directTestSchema = z.object({
  accountId: z.string().uuid(),
  confirm: z.literal("DIRECT_STALWART_TEST"),
});

export default async (app: FastifyInstance) => {
  await requireUser(app, { optional: false });


  app.post("/mail/send/direct-test", async (req) => {
    const input = directTestSchema.parse(req.body);
    const recipient = process.env.DIRECT_STALWART_TEST_RECIPIENT?.trim();
    if (!recipient) throw new Error("DIRECT_STALWART_TEST_RECIPIENT is not configured");
    if (!req.authUserId) throw new Error("mailbox auth identity is unavailable");
    if (config.mailEngine === "demo") throw new Error("direct JMAP submission requires Stalwart");

    const account = await requireAccountPermission(req.user!.id, input.accountId, "send");
    if (account.status !== "active" || account.authSetupStatus !== "ready") {
      throw new Error("mailbox is not ready for mail access");
    }

    const token = await getStalwartAccessToken({
      authUserId: req.authUserId,
      accountId: account.id,
      headers: req.headers as Record<string, string>,
    });
    const client = new JmapClient({
      baseUrl: config.stalwart.jmapUrl,
      token,
      sessionTtlMs: config.stalwart.sessionTtlSeconds * 1000,
    });

    const session = await client.session();
    const accountId = client.resolveAccountId(session, account.address);
    const submissionAccountId = session.primaryAccounts["urn:ietf:params:jmap:submission"] ?? accountId;

    const discovery = await client.call([
      ["Identity/get", { accountId: submissionAccountId, ids: null }, "i1"],
      ["Mailbox/get", { accountId, ids: null, properties: ["id", "name", "role"] }, "m1"],
    ]);

    const identities = (discovery[0]?.[1]?.list ?? []) as { id?: unknown; email?: unknown }[];
    const identity = identities.find(
      (item) => typeof item.email === "string" && item.email.toLowerCase() === account.address.toLowerCase(),
    );
    if (!identity || typeof identity.id !== "string") {
      throw new Error(`no Stalwart JMAP identity found for ${account.address}`);
    }

    const mailboxes = (discovery[1]?.[1]?.list ?? []) as { id?: unknown; role?: unknown; name?: unknown }[];
    const drafts = mailboxes.find((item) => item.role === "drafts") ?? mailboxes.find((item) => item.name === "Drafts");
    const sent = mailboxes.find((item) => item.role === "sent") ?? mailboxes.find((item) => item.name === "Sent");
    if (!drafts || typeof drafts.id !== "string") throw new Error("Stalwart Drafts mailbox is unavailable");
    if (!sent || typeof sent.id !== "string") throw new Error("Stalwart Sent mailbox is unavailable");

    const emailCreate = await client.call([
      [
        "Email/set",
        {
          accountId,
          create: {
            directTest: {
              mailboxIds: { [drafts.id]: true },
              from: [{ email: account.address }],
              to: [{ email: recipient }],
              subject: "Stalwart direct delivery test",
              bodyValues: { body: { value: "Direct delivery test from Stalwart without Resend." } },
              textBody: [{ partId: "body", type: "text/plain" }],
              keywords: { $draft: true, $seen: true },
            },
          },
        },
        "e1",
      ],
    ]);

    const email = (emailCreate[0]?.[1]?.created as Record<string, { id?: string }> | undefined)?.directTest;
    if (!email?.id) {
      throw new JmapError(
        "direct-test email creation failed",
        "email_not_created",
        "e1",
        emailCreate[0]?.[1]?.notCreated,
      );
    }

    const submissionCreate = await client.call([
      [
        "EmailSubmission/set",
        {
          accountId: submissionAccountId,
          create: {
            directTest: {
              emailId: email.id,
              identityId: identity.id,
            },
          },
        },
        "s1",
      ],
    ]);

    const submission = (submissionCreate[0]?.[1]?.created as Record<string, { id?: string }> | undefined)?.directTest;
    if (!submission?.id) {
      throw new JmapError(
        "direct-test submission failed",
        "submission_not_created",
        "s1",
        submissionCreate[0]?.[1]?.notCreated,
      );
    }

    let sentMailboxUpdated = true;
    try {
      await client.call([
        [
          "Email/set",
          {
            accountId,
            update: {
              [email.id]: {
                mailboxIds: { [sent.id]: true },
                keywords: { $seen: true },
              },
            },
          },
          "e2",
        ],
      ]);
    } catch (error) {
      sentMailboxUpdated = false;
      req.log.warn(
        { err: error, accountId: account.id, emailId: email.id, submissionId: submission.id },
        "direct Stalwart submission succeeded but Sent move failed",
      );
    }

    req.log.info(
      { accountId: account.id, from: account.address, to: recipient, emailId: email.id, submissionId: submission.id },
      "direct Stalwart delivery test submitted",
    );

    return {
      submitted: true,
      emailId: email.id,
      submissionId: submission.id,
      sentMailboxUpdated,
    };
  });

  app.post("/mail/send", { bodyLimit: SEND_BODY_LIMIT }, async (req, reply) => {
    const input = sendSchema.parse(req.body);
    const account = await requireAccountPermission(req.user!.id, input.accountId, "send");
    try {
      const result = await submitSend({
        userId: req.user!.id,
        accessToken: req.accessToken,
        authUserId: req.authUserId,
        headers: req.headers as Record<string, string>,
        account,
        to: input.to,
        cc: input.cc,
        bcc: input.bcc,
        subject: input.subject,
        textBody: input.textBody,
        htmlBody: input.htmlBody,
        templateKey: input.templateKey,
        mode: input.mode,
        replyTo: input.replyTo,
        inReplyTo: input.inReplyTo,
        references: input.references,
        attachments: input.attachments,
        clientRequestId: input.clientRequestId,
      });
      reply.code(202);
      return {
        sendId: result.sendId,
        messageId: result.messageId,
        threadId: result.threadId,
        status: result.transportStatus,
        undoUntil: result.undoUntil,
        ...(result.idempotentReplay ? { idempotentReplay: true } : {}),
      };
    } catch (error) {
      req.log.error({
        err: error,
        jmap: { method: "Email/set", operation: "sent" },
        accountId: input.accountId,
        replyMode: input.mode ?? (input.inReplyTo ? "reply" : "new"),
        recipients: { to: input.to, cc: input.cc ?? [], bccCount: input.bcc?.length ?? 0 },
        subject: input.subject ?? "",
        threading: { hasInReplyTo: Boolean(input.inReplyTo), hasReferences: Boolean(input.references) },
        attachmentCount: input.attachments?.length ?? 0,
        jmapFailure: describeJmapFailure(error),
      }, "mail send failed");
      throw error;
    }
  });
};