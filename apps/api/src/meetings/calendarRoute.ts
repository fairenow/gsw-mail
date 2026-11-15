import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAccountPermission } from "../auth/authorize.js";
import { pool } from "../db/client.js";
import { forbidden, serviceUnavailable } from "../lib/errors.js";
import { createMeetingClient, MeetingServiceError } from "./client.js";
import { hasPaidMeetingAccess } from "./entitlement.js";

const inputSchema = z.object({
  accountId: z.string().uuid(), externalEventId: z.string().uuid(), title: z.string().trim().min(1).max(500),
  scheduledAt: z.string().datetime({ offset: true }), timezone: z.string().min(1).max(100),
}).strict();

export function registerCalendarMeetingRoute(app: FastifyInstance) {
  app.post("/product/calendar-meetings/host", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req, reply) => {
    reply.header("cache-control", "no-store");
    if (process.env.GSW_MEETINGS_ENABLED !== "true") throw serviceUnavailable("meetings_disabled");
    const input = z.object({ accountId: z.string().uuid(), externalEventId: z.string().uuid(), meetingId: z.string().regex(/^[a-zA-Z0-9_-]{1,200}$/) }).strict().parse(req.body);
    const account = await requireAccountPermission(req.user!.id, input.accountId, "manage");
    if (account.status !== "active") throw forbidden("meeting_account_inactive");
    const { rows } = await pool.query<{status: string; mailbox_quantity: number; current_period_end: Date | null}>(
      "SELECT status, mailbox_quantity, current_period_end FROM billing_subscriptions WHERE organization_id=$1", [account.organizationId]);
    if (!hasPaidMeetingAccess(rows[0])) throw forbidden("meeting_entitlement_required");
    try {
      const client = createMeetingClient({ apiUrl: process.env.GSW_MEETINGS_API_URL ?? "", webOrigin: process.env.GSW_MEETINGS_WEB_ORIGIN ?? "", signingSecret: process.env.GSW_MEETINGS_SIGNING_SECRET ?? "" });
      return await client.issueHost({ userId: req.user!.id, workspaceId: account.organizationId, videoMeetings: true }, {
        meetingId: input.meetingId, externalEventId: `${input.accountId}:${input.externalEventId}`,
      });
    } catch { throw serviceUnavailable("meeting_handoff_unavailable"); }
  });
  app.post("/product/calendar-meetings", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async req => {
    if (process.env.GSW_MEETINGS_ENABLED !== "true") throw serviceUnavailable("meetings_disabled");
    const input = inputSchema.parse(req.body);
    const account = await requireAccountPermission(req.user!.id, input.accountId, "manage");
    if (account.status !== "active") throw forbidden("meeting_account_inactive");
    const { rows } = await pool.query<{status: string; mailbox_quantity: number; current_period_end: Date | null}>(
      "SELECT status, mailbox_quantity, current_period_end FROM billing_subscriptions WHERE organization_id=$1", [account.organizationId]);
    if (!hasPaidMeetingAccess(rows[0])) throw forbidden("meeting_entitlement_required");
    let client: ReturnType<typeof createMeetingClient>;
    try {
      client = createMeetingClient({ apiUrl: process.env.GSW_MEETINGS_API_URL ?? "", webOrigin: process.env.GSW_MEETINGS_WEB_ORIGIN ?? "", signingSecret: process.env.GSW_MEETINGS_SIGNING_SECRET ?? "" });
    } catch { throw serviceUnavailable("meetings_not_configured"); }
    try {
      return await client.createRoom({ userId: req.user!.id, workspaceId: account.organizationId, videoMeetings: true }, {
        externalEventId: `${input.accountId}:${input.externalEventId}`, title: input.title, scheduledAt: input.scheduledAt, timezone: input.timezone,
      });
    } catch (error) {
      if (error instanceof MeetingServiceError) throw serviceUnavailable(error.code);
      throw error;
    }
  });
}
