import { Resend } from "resend";
import { config } from "../config.js";
import type { OutboundJob, OutboundRelay, RelayResult } from "./types.js";

export const NullRelay: OutboundRelay = {
  name: "null",
  async send(job: OutboundJob): Promise<RelayResult> {
    console.info(`[relay:null] would deliver to ${job.to.join(", ")} subject="${job.subject ?? ""}"`);
    return { accepted: true, message: "accepted by null relay (no transport configured)" };
  },
};

export function createResendRelay(apiKey: string): OutboundRelay {
  const client = new Resend(apiKey);
  return {
    name: "resend",
    async send(job: OutboundJob): Promise<RelayResult> {
      const options = {
        from: job.fromAddress,
        to: job.to,
        subject: job.subject ?? "",
        text: job.textBody ?? "",
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