import { config } from "../config.js";
import { createMailboxTargetedStalwartRelay } from "./stalwartRelay.js";
import type { OutboundJob, OutboundRelay, RelayAttachment, RelayResult } from "./types.js";

/**
 * Header values pulled from received mail can contain RFC 5322 folding (CRLF +
 * whitespace). Stalwart preserves those values, but external transports can
 * reject raw CR/LF/NUL in header values. Unfold and strip control characters
 * before handing threading headers to a provider.
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

export function createStalwartRelay(): OutboundRelay {
  return createMailboxTargetedStalwartRelay();
}

export function getRelay(): OutboundRelay {
  if (config.outbound.relay === "stalwart") return createStalwartRelay();
  return NullRelay;
}
