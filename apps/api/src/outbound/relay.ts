import { eq } from "drizzle-orm";
import { Resend } from "resend";
import { config } from "../config.js";
import { db } from "../db/client.js";
import { outboundMessages } from "../db/schema.js";
import { JmapClient, JmapError } from "../engine/jmap.js";
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

export function createResendRelay(apiKey: string): OutboundRelay {
  const client = new Resend(apiKey);
  return {
    name: "resend",
    async send(job: OutboundJob, attachments?: RelayAttachment[]): Promise<RelayResult> {
      const headers: Record<string, string> = {};
      const messageId = sanitizeOutboundHeaderValue(job.messageId);
      const inReplyTo = sanitizeOutboundHeaderValue(job.inReplyTo);
      const references = sanitizeOutboundHeaderValue(job.references);
      const replyTo = sanitizeOutboundHeaderValue(job.replyTo);
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
        ...(replyTo ? { replyTo } : {}),
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

function stalwartAdminAuthorization(): string {
  if (config.stalwart.adminUsername && config.stalwart.adminPassword) {
    return `Basic ${Buffer.from(`${config.stalwart.adminUsername}:${config.stalwart.adminPassword}`, "utf8").toString("base64")}`;
  }
  if (config.stalwart.adminToken) return `Bearer ${config.stalwart.adminToken}`;
  throw new Error("Stalwart admin credentials are not configured");
}

/**
 * Submits the already-persisted Stalwart Email object directly through
 * EmailSubmission/set. The normal send flow stores the message in Stalwart
 * before it reaches the outbound worker, so attachments/body data do not need
 * to be re-uploaded here.
 *
 * The worker intentionally uses the server-side Stalwart administrator
 * credential rather than storing a user's short-lived OAuth token in the
 * outbound queue. This keeps Undo Send/retries asynchronous without persisting
 * user bearer credentials.
 */
export function createStalwartRelay(): OutboundRelay {
  return {
    name: "stalwart",
    async send(job: OutboundJob): Promise<RelayResult> {
      try {
        const [row] = await db
          .select({ engineMessageId: outboundMessages.engineMessageId })
          .from(outboundMessages)
          .where(eq(outboundMessages.id, job.id))
          .limit(1);
        const emailId = row?.engineMessageId;
        if (!emailId) {
          return { accepted: false, permanent: true, message: "Stalwart email id is unavailable for outbound submission" };
        }

        const client = new JmapClient({
          baseUrl: config.stalwart.jmapUrl,
          authorization: stalwartAdminAuthorization(),
          sessionTtlMs: config.stalwart.sessionTtlSeconds * 1000,
        });
        const session = await client.session();
        const accountId = client.resolveAccountId(session, job.fromAddress);
        const submissionAccountId = session.primaryAccounts["urn:ietf:params:jmap:submission"] ?? accountId;
        const identityResponse = await client.call([
          ["Identity/get", { accountId: submissionAccountId, ids: null }, "i1"],
        ]);
        const identities = (identityResponse[0]?.[1]?.list ?? []) as { id?: unknown; email?: unknown }[];
        const identity = identities.find(
          (item) => typeof item.email === "string" && item.email.toLowerCase() === job.fromAddress.toLowerCase(),
        );
        if (!identity || typeof identity.id !== "string") {
          return { accepted: false, permanent: true, message: `No Stalwart JMAP identity found for ${job.fromAddress}` };
        }

        const response = await client.call([
          [
            "EmailSubmission/set",
            {
              accountId: submissionAccountId,
              create: {
                outbound: {
                  emailId,
                  identityId: identity.id,
                },
              },
            },
            "s1",
          ],
        ]);
        const created = (response[0]?.[1]?.created as Record<string, { id?: string }> | undefined)?.outbound;
        if (!created?.id) {
          const notCreated = response[0]?.[1]?.notCreated;
          return { accepted: false, message: `Stalwart submission was not created: ${JSON.stringify(notCreated ?? {})}` };
        }
        return { accepted: true, deliveryId: created.id };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const permanent = error instanceof JmapError && ["invalidArguments", "notFound", "forbidden"].includes(error.type);
        return { accepted: false, permanent, message };
      }
    },
  };
}

export function getRelay(): OutboundRelay {
  if (config.outbound.relay === "resend") {
    if (!config.outbound.resendApiKey) throw new Error("OUTBOUND_RELAY=resend requires RESEND_API_KEY");
    return createResendRelay(config.outbound.resendApiKey);
  }
  if (config.outbound.relay === "stalwart") return createStalwartRelay();
  return NullRelay;
}
