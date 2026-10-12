import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { emailAccounts } from "../db/schema.js";
import { sendStalwartWelcomeMail } from "./scheduledStalwart.js";

/**
 * Internal email-delivery boundary. This is deliberately NOT a public API.
 * The sender is bound to an existing product mailbox and Stalwart identity,
 * not a caller-controlled From header. Developer tenants will later use a
 * separate scoped authorization layer before reaching this boundary.
 */
export type InternalDeliveryRequest = {
  kind: "transactional";
  sender: "admin@team.guidedstepswellness.com";
  recipient: string;
  subject: string;
  text: string;
  html: string;
};

export interface InternalEmailDelivery {
  send(request: InternalDeliveryRequest): Promise<{ submissionId: string }>;
}

export const GSW_ADMIN_SENDER = "admin@team.guidedstepswellness.com" as const;

export function validateTransactionalDelivery(request: InternalDeliveryRequest): void {
  if (request.kind !== "transactional" || request.sender !== GSW_ADMIN_SENDER)
    throw new Error("Internal delivery only supports the verified GSW administrator sender");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(request.recipient) || request.recipient.length > 320)
    throw new Error("Invalid transactional email recipient");
  if (!request.subject.trim() || request.subject.length > 998)
    throw new Error("Invalid transactional email subject");
  if (!request.text.trim() || !request.html.trim())
    throw new Error("Transactional emails require text and HTML alternatives");
}

export const stalwartInternalDelivery: InternalEmailDelivery = {
  async send(request) {
    validateTransactionalDelivery(request);
    const [mailbox] = await db.select({ id: emailAccounts.id })
      .from(emailAccounts).where(eq(emailAccounts.address, request.sender)).limit(1);
    if (!mailbox) throw new Error("GSW administrator sender mailbox is not configured");
    const submissionId = await sendStalwartWelcomeMail({
      productAccountId: mailbox.id,
      from: request.sender,
      to: request.recipient,
      subject: request.subject,
      text: request.text,
      html: request.html,
    });
    return { submissionId };
  },
};

/** Send transactional mail without exposing Stalwart credentials to callers. */
export const sendInternalTransactionalEmail = (input: Omit<InternalDeliveryRequest, "kind" | "sender">) =>
  stalwartInternalDelivery.send({ kind: "transactional", sender: GSW_ADMIN_SENDER, ...input });
