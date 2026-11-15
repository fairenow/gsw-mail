import { createHash, randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import { z } from "zod";

const createInput = z.object({
  externalEventId: z.string().min(1).max(200),
  title: z.string().trim().min(1).max(500),
  scheduledAt: z.string().datetime({ offset: true }),
  timezone: z.string().min(1).max(100).refine(value => {
    try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; }
  }),
}).strict();
const roomResponse = z.object({
  meetingId: z.string().min(1).max(200),
  joinUrl: z.string().url().max(2000),
  status: z.literal("scheduled"),
}).strict();

export class MeetingServiceError extends Error {
  constructor(readonly code: "meeting_service_unavailable" | "meeting_service_rejected" | "meeting_service_invalid_response", readonly status?: number) {
    super(code);
  }
}

export type MeetingServiceConfig = { apiUrl: string; webOrigin: string; signingSecret: string };
export type MeetingOrganizer = { userId: string; workspaceId: string; videoMeetings: boolean };

function trustedOrigin(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash)
    throw new Error("Meeting configuration requires an HTTPS origin");
  return url.origin;
}

export function createMeetingClient(config: MeetingServiceConfig, transport: typeof fetch = fetch) {
  const apiOrigin = trustedOrigin(config.apiUrl);
  const webOrigin = trustedOrigin(config.webOrigin);
  const key = new TextEncoder().encode(config.signingSecret);
  if (key.byteLength < 32) throw new Error("Meeting signing secret must contain at least 32 bytes");

  async function request(organizer: MeetingOrganizer, input: unknown, operation: "rooms.create" | "rooms.handoff" | "rooms.update" | "rooms.cancel", path: string) {
      if (!organizer.userId || !organizer.workspaceId || ((operation === "rooms.create" || operation === "rooms.handoff") && !organizer.videoMeetings)) throw new Error("Meeting organizer entitlement required");
      const body = JSON.stringify(input);
      const assertion = await new SignJWT({
        workspaceId: organizer.workspaceId,
        videoMeetings: organizer.videoMeetings,
        operation,
        bodySha256: createHash("sha256").update(body).digest("hex"),
      }).setProtectedHeader({ alg: "HS256", typ: "JWT" })
        .setIssuer("gsw-mail").setAudience("bible-study-meetings")
        .setSubject(organizer.userId).setJti(randomUUID()).setIssuedAt().setExpirationTime("60s").sign(key);
      let response: Response;
      try {
        response = await transport(`${apiOrigin}/integrations/gsw-mail/${path}`, {
          method: "POST", redirect: "error", signal: AbortSignal.timeout(10_000),
          headers: { authorization: `Bearer ${assertion}`, "content-type": "application/json" }, body,
        });
      } catch { throw new MeetingServiceError("meeting_service_unavailable"); }
      if (!response.ok) {
        await response.body?.cancel();
        throw new MeetingServiceError(response.status >= 500 ? "meeting_service_unavailable" : "meeting_service_rejected", response.status);
      }
      try {
        const reader = response.body?.getReader();
        if (!reader) throw new Error("Empty response");
        const chunks: Uint8Array[] = [];
        let length = 0;
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            length += value.byteLength;
            if (length > 16_384) throw new Error("Response too large");
            chunks.push(value);
          }
        } finally { await reader.cancel(); }
        return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
      } catch { throw new MeetingServiceError("meeting_service_invalid_response"); }
  }
  return {
    async createRoom(organizer: MeetingOrganizer, input: z.input<typeof createInput>) {
      const raw = await request(organizer, createInput.parse(input), "rooms.create", "rooms");
      try {
        const result = roomResponse.parse(raw);
        const url = new URL(result.joinUrl);
        if (url.origin !== webOrigin || url.username || url.password || url.hash || url.search || url.pathname !== `/meet/${result.meetingId}`)
          throw new Error("Unexpected invitation URL");
        return result;
      } catch { throw new MeetingServiceError("meeting_service_invalid_response"); }
    },
    async updateRoom(organizer: MeetingOrganizer, input: { meetingId: string; title: string; scheduledAt: string; timezone: string }) {
      return request(organizer, input, "rooms.update", "rooms/update");
    },
    async cancelRoom(organizer: MeetingOrganizer, meetingId: string) {
      return request(organizer, {meetingId}, "rooms.cancel", "rooms/cancel");
    },
    async issueHost(organizer: MeetingOrganizer, input: { meetingId: string; externalEventId?: string }) {
      const validated = z.object({ meetingId: z.string().regex(/^[a-zA-Z0-9_-]{1,200}$/), externalEventId: z.string().min(1).max(200).optional() }).strict().parse(input);
      const raw = await request(organizer, validated, "rooms.handoff", "host");
      try {
        const result = z.object({ ticket: z.string().regex(/^[a-f0-9]{64}$/), meetingId: z.string(), expiresAt: z.number().int() }).strict().parse(raw);
        if (result.meetingId !== input.meetingId || result.expiresAt <= Date.now() || result.expiresAt > Date.now() + 65000)
          throw new Error("Invalid host ticket");
        return { ...result, exchangeUrl: `${webOrigin}/api/meet/handoff` };
      } catch { throw new MeetingServiceError("meeting_service_invalid_response"); }
    },
  };
}
