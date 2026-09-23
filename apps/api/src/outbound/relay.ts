import { Resend } from "resend";
import { config } from "../config.js";
import type { OutboundJob, OutboundRelay, RelayAttachment, RelayResult } from "./types.js";

/**
 * Header values pulled from received mail can contain RFC 5322 folding (CRLF +
 * whitespace). Stalwart preserves those values, but Resend/Undici correctly
 * rejects raw CR/LF/NUL in header values. Unfold and strip control characters
 * before handing threading headers to the provider.
 */
export function sanitizeOutboundHeaderValue(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const sanitized = value
    .replace(/\r\n[ \t]+/g, " ")
    .replace(/[\r\n\0]+/g, " ")
    .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return sanitized || undefined;
}

export function isInvalidHeaderError(message: string | null | undefined): boolean {
  if (!message) return false;
  return /header keys and values cannot contain carriage return, line feed, or null characters|invalid header|invalid.*header/i.test(message);
}

export const NullRelay: OutboundRelay = {
  name: "null",
  async send(job: OutboundJob, attachments?: RelayAttachment[]): Promise<RelayResult> {
    console.info(
      `[relay:null] would deliver to ${job.to.join(", ")} subject="${job.subject ?? ""}" messageId=${job.messageId ?? ""} attachments=${attachments?.length ?? 0}`,
    );
    return { accepted: true, deliveryId: `null-${job.id}` };
  },
};

export function createResendRelay(apiKey: string): OutboundRelay {
  const client = new Resend(apiKey);
  return {
    name: "resend",
    async send(job: OutboundJob, attachments?: RelayAttachment[]): Promise<RelayResult> {
      const headers: Record<string, string> = {};
      const messageId = sanitizeOutboundHeaderValue(job.messageId);
      const inReplyTo = sanitizeOutboundHeaderValue(job.inReplyTo);
      const references = sanitizeOutboundHeaderValue(job.references);
      if (messageId) headers["Message-ID"] = messageId;
      if (inReplyTo) headers["In-Reply-To"] = inReplyTo;
      if (references) headers["References"] = references;

      const options = {
        from: job.fromAddress,
        to: job.to,
        subject: sanitizeOutboundHeaderValue(job.subject) ?? "",
        text: job.textBody ?? "",
        ...(Object.keys(headers).length ? { headers } : {}),
        ...(job.cc ? { cc: job.cc } : {}),
        ...(job.bcc ? { bcc: job.bcc } : {}),
        ...(job.htmlBody ? { html: job.htmlBody } : {}),
        ...(job.replyTo ? { replyTo: sanitizeOutboundHeaderValue(job.replyTo) } : {}),
        ...(attachments?.length
          ? {
              attachments: attachments.map((a) => ({
                filename: a.filename,
                contentType: a.contentType,
                content: a.content,
                ...(a.contentId ? { contentId: a.contentId } : {}),
              })),
            }
          : {}),
      };
      try {
        const response = await client.emails.send(options);
        if (response.error) {
          return {
            accepted: false,
            permanent: isInvalidHeaderError(response.error.message),
            message: response.error.message,
          };
        }
        return { accepted: true, deliveryId: response.data?.id };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          accepted: false,
          permanent: isInvalidHeaderError(message),
          message,
        };
      }
    },
  };
}

export function getRelay(): OutboundRelay {
  if (config.outbound.relay === "resend") {
    if (!config.outbound.resendApiKey) throw new Error("OUTBOUND_RELAY=resend requires RESEND_API_KEY");
    return createResendRelay(config.outbound.resendApiKey);
  }
  return NullRelay;
}
