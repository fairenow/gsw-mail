import { randomUUID } from "node:crypto";

export const normalizeMessageIdValue = (value: string): string => value.trim().replace(/^<+|>+$/g, "").trim();

export const formatMessageIdHeader = (value: string): string => `<${normalizeMessageIdValue(value)}>`;

/**
 * JMAP's messageId property is the parsed msg-id value, without the RFC 5322
 * angle brackets. Transports that write a raw Message-ID header should call
 * formatMessageIdHeader() at the boundary instead.
 */
export const generateMessageId = (domain = "mail.guidedstepswellness.com"): string => `${randomUUID()}@${domain}`;
