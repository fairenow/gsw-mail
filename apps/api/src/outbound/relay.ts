import { Resend } from "resend";
import { config } from "../config.js";
import type { OutboundJob, OutboundRelay, RelayResult } from "./types.js";

export const NullRelay: OutboundRelay = {
  name: "null",
  async send(job: OutboundJob): Promise<RelayResult> {
    console.info(`[relay:null] would deliver to ${job.to.join(", ")} subject="${job.subject ?? ""}" messageId=${job.messageId ?? ""}`);
    return { accepted: true, deliveryId: `null-${job.id}` };
  },
};

export function createResendRelay(apiKey: string): OutboundRelay {
  const client = new Resend(apiKey);
  return {
    name: "resend",
    async send(job: OutboundJob): Promise<RelayResult> {
      const headers: Record<string, string> = {};
      if (job.messageId) headers["Message-ID"] = job.messageId;
      if (job.inReplyTo) headers["In-Reply-To"] = job.inReplyTo;
      if (job.references) headers["References"] = job.references;

      const options = {
        from: job.fromAddress,
        to: job.to,
        subject: job.subject ?? "",
        text: job.textBody ?? "",
        ...(headers["Message-ID"] || headers["In-Reply-To"] || headers["References"] ? { headers } : {}),
        ...(job.cc ? { cc: job.cc } : {}),
        ...(job.bcc ? { bcc: job.bcc } : {}),
        ...(job.htmlBody ? { html: job.htmlBody } : {}),
        ...(job.replyTo ? { replyTo: job.replyTo } : {}),
      };
      const response = await client.emails.send(options);
      if (response.error) {
        return { accepted: false, message: response.error.message };
      }
      return { accepted: true, deliveryId: response.data?.id };
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