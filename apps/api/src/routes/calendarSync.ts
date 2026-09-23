import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser } from "../auth/middleware.js";
import { requireAccountPermission } from "../auth/authorize.js";
import { getUserEngine } from "../engine/index.js";
import { parseCalendarInvites } from "../lib/calendarInvites.js";

const bodySchema = z.object({ accountId: z.string().min(1) });
const eventKey = (event: { title: string; start: string; location?: string }) => `${event.title.trim().toLowerCase()}|${event.start}|${(event.location ?? "").trim().toLowerCase()}`;

export default async function calendarSyncRoutes(app: FastifyInstance) {
  await requireUser(app, { optional: false });

  app.post("/product/calendar-events/sync-invitations", async (req) => {
    const { accountId } = bodySchema.parse(req.body);
    await requireAccountPermission(req.user!.id, accountId, "send");
    const engine = await getUserEngine({
      productUserId: req.user!.id,
      authUserId: req.authUserId ?? req.user!.id,
      accountId,
      headers: req.headers as Record<string, string>,
      permission: "send",
    });

    const calendars = await engine.listCalendars(accountId);
    const calendar = calendars.find((item) => item.isDefault) ?? calendars[0];
    if (!calendar) return { created: 0, scanned: 0, skipped: 0 };

    const now = new Date();
    const existing = await engine.listCalendarEvents(
      accountId,
      new Date(now.getFullYear() - 1, 0, 1).toISOString(),
      new Date(now.getFullYear() + 3, 0, 1).toISOString(),
    );
    const existingKeys = new Set(existing.map(eventKey));
    const messages = await engine.listMessages(accountId, { mailbox: "Inbox", limit: 100, offset: 0 });
    let created = 0;
    let skipped = 0;
    let scanned = 0;

    for (const summary of messages.filter((message) => message.hasAttachments)) {
      const message = await engine.getMessage(accountId, summary.engineId);
      if (!message) continue;
      for (const attachment of message.attachments.filter((item) => item.contentType.toLowerCase().includes("text/calendar") || item.filename.toLowerCase().endsWith(".ics"))) {
        scanned += 1;
        if (attachment.size > 1_000_000) { skipped += 1; continue; }
        const body = await engine.getAttachment(accountId, attachment.engineId);
        if (!body) { skipped += 1; continue; }
        const invites = parseCalendarInvites(body.content.toString("utf8"), calendar.engineId);
        for (const invite of invites) {
          if (invite.method === "CANCEL") { skipped += 1; continue; }
          const key = eventKey(invite);
          if (existingKeys.has(key)) { skipped += 1; continue; }
          try {
            const saved = await engine.createCalendarEvent(accountId, invite);
            existingKeys.add(eventKey(saved));
            created += 1;
          } catch (error) {
            skipped += 1;
            req.log.warn({ err: error, messageId: summary.engineId, attachment: attachment.filename }, "calendar invitation import failed");
          }
        }
      }
    }

    return { created, scanned, skipped };
  });
}
