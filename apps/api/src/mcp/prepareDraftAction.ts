import { z } from "zod";

/** Mirrors the mail.create_draft runtime validation without invoking it. */
export const mcpDraftArguments = z.object({
  to: z.array(z.string().email()).min(1).max(100),
  cc: z.array(z.string().email()).max(100).optional(),
  bcc: z.array(z.string().email()).max(100).optional(),
  subject: z.string().max(998).optional(),
  textBody: z.string().max(200_000).optional(),
  htmlBody: z.string().max(500_000).optional(),
  replyTo: z.string().email().optional(),
  inReplyTo: z.string().max(2_000).optional(),
  references: z.string().max(8_000).optional(),
}).strict();

export const mcpPrepareDraftRequest = z.object({
  accountId: z.string().uuid(),
  toolName: z.literal("mail.create_draft"),
  arguments: mcpDraftArguments,
}).strict();

export function describeMcpDraft(input: z.infer<typeof mcpDraftArguments>): string {
  const recipientCount = input.to.length + (input.cc?.length ?? 0) + (input.bcc?.length ?? 0);
  const subject = (input.subject ?? "(no subject)").replace(/[\r\n\t]/g, " ").slice(0, 180);
  return `Create email draft for ${recipientCount} recipient(s), subject: ${subject}`.slice(0, 1000);
}
