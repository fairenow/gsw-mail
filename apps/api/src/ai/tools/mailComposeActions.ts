import { z } from "zod";
import { createMailService } from "../../services/mailService.js";
import { requireAccountPermission } from "../../auth/authorize.js";
import { reportChatError } from "../chatSafeErrors.js";
import type { AgentToolDefinition, AgentExecutionContext } from "./types.js";

const inputSchema = {
  type: "object",
  properties: {
    messageId: { type: "string", description: "Original message ID in this authorized mailbox" },
    textBody: { type: "string", description: "User-approved reply text or introduction for the forwarded message" },
    to: { type: "array", items: { type: "string" }, description: "Required only for forward: explicit destination addresses" },
  },
  required: ["messageId", "textBody"],
  additionalProperties: false,
};
const actionInput = z.object({
  messageId: z.string().min(1).max(1000),
  textBody: z.string().trim().min(1).max(200000),
  to: z.array(z.string().email()).min(1).max(100).optional(),
});
type Mode = "reply" | "replyAll" | "forward";
const header = (headers: Record<string, string>, name: string) =>
  Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1]?.trim();
const uniqueEmails = (emails: string[]) => [...new Map(emails.map(e => [e.toLowerCase(), e])).values()];
const prefix = (subject: string, mode: Mode) =>
  new RegExp(mode === "forward" ? "^fwd\\s*:" : "^re\\s*:", "i").test(subject)
    ? subject : `${mode === "forward" ? "Fwd" : "Re"}: ${subject}`;

function draftTool(mode: Mode): AgentToolDefinition {
  const name = mode === "replyAll" ? "reply_all" : mode;
  return {
    name: `mail.${name}`,
    description: mode === "forward"
      ? "Prepare a forward draft of an existing message to explicitly supplied recipients. Includes the original text, but does not automatically carry over attachments and never sends."
      : `Prepare a ${mode === "replyAll" ? "reply-all" : "reply"} draft from an existing message with server-derived recipients and RFC threading headers. Does not send.`,
    inputSchema: { ...inputSchema, required: mode === "forward" ? ["messageId", "textBody", "to"] : ["messageId", "textBody"] },
    requiredScopes: ["mail.read", "mail.write"],
    risk: "reversible_write",
    async execute(ctx: AgentExecutionContext, rawInput, toolCallId) {
      const startedAt = new Date().toISOString();
      const audit = () => ({ userId: ctx.userId, accountId: ctx.accountId, startedAt, completedAt: new Date().toISOString() });
      try {
        const input = actionInput.parse(rawInput);
        if (mode !== "forward" && input.to !== undefined) throw new Error("recipients_are_derived_from_source");
        if (mode === "forward" && !input.to) throw new Error("forward_recipients_required");
        const account = await requireAccountPermission(ctx.userId, ctx.accountId, "send");
        const mail = createMailService(ctx);
        const original = await mail.readMessage(ctx.accountId, input.messageId, false);
        if (/draft/i.test(original.mailbox)) throw new Error("cannot_reply_to_draft");
        const messageId = header(original.headers, "Message-ID");
        if (mode !== "forward" && (!messageId || !/^<[^<>\\r\\n]+>$/.test(messageId)))
          throw new Error("original_rfc_message_id_required");
        const sender = original.from?.email;
        if (mode !== "forward" && !sender) throw new Error("original_sender_missing");
        const self = account.address.toLowerCase();
        const to = mode === "forward"
          ? uniqueEmails(input.to!)
          : uniqueEmails([sender!, ...(mode === "replyAll" ? original.to.map(a => a.email) : [])])
            .filter(e => e.toLowerCase() !== self);
        const cc = mode === "replyAll"
          ? uniqueEmails(original.cc.map(a => a.email))
            .filter(e => e.toLowerCase() !== self && !to.some(t => t.toLowerCase() === e.toLowerCase()))
          : [];
        if (!to.length) throw new Error("no_eligible_recipients");
        const references = mode !== "forward"
          ? [header(original.headers, "References"), messageId].filter(Boolean).join(" ").slice(0, 8000)
          : undefined;
        const textBody = mode === "forward"
          ? `${input.textBody}\n\n---------- Forwarded message ----------\nFrom: ${original.from?.email ?? "unknown"}\nDate: ${original.date.toISOString()}\nSubject: ${original.subject}\nTo: ${original.to.map(a => a.email).join(", ")}\n\n${original.textBody ?? "[Original message has no plain-text body]"}`
          : input.textBody;
        const result = await mail.createDraft(ctx.accountId, {
          to, ...(cc.length ? { cc } : {}),
          subject: prefix(original.subject, mode),
          textBody,
          mode: mode === "replyAll" ? "replyAll" : mode,
          ...(mode !== "forward" ? { inReplyTo: messageId!, references } : {}),
        });
        return { ok: true, toolCallId, data: { ...result, to, cc, subject: prefix(original.subject, mode), sent: false, originalMessageId: input.messageId, ...(mode === "forward" ? { attachmentsCopied: false } : {}) }, audit: audit() };
      } catch (error) {
        return { ok: false, toolCallId, error: reportChatError(error, { operation: `mail.${name}`, category: "mail" }), audit: audit() };
      }
    },
  };
}

export const mailComposeActions: AgentToolDefinition[] = [
  draftTool("reply"),
  draftTool("replyAll"),
  draftTool("forward"),
];
