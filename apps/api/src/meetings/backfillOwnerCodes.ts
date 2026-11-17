import { pool } from "../db/client.js";
import { getUserEngine } from "../engine/index.js";
import { meetingOrganizer } from "./access.js";
import { createMeetingClient } from "./client.js";
import { meetingStartUtc, partnerMeetingId } from "./calendarSync.js";
import { createOwnerCode } from "./ownerCode.js";

export async function backfillMeetingOwnerCodes() {
  const counts = { created: 0, existing: 0, skipped: 0, failed: 0, mailboxesScanned: 0, mailboxesUnavailable: 0 };
  if (process.env.GSW_MEETINGS_ENABLED !== "true") return counts;
  const lock = await pool.connect();
  const acquired = await lock.query<{ acquired: boolean }>("SELECT pg_try_advisory_lock(hashtext('meeting-owner-code-backfill')) AS acquired");
  if (!acquired.rows[0]?.acquired) { lock.release(); return counts; }
  const seen = new Set<string>();
  const ensure = async (url: string | null, accountId: string, userId: string, start: string) => {
    const id = partnerMeetingId(url ?? undefined);
    if (!id || seen.has(`${id}:${userId}`)) return;
    seen.add(`${id}:${userId}`);
    try {
      const existing = await pool.query("SELECT 1 FROM meeting_owner_codes WHERE meeting_id=$1", [id]);
      if (existing.rows.length) { counts.existing++; return; }
      const organizer = await meetingOrganizer(userId, accountId);
      const client = createMeetingClient({ apiUrl: process.env.GSW_MEETINGS_API_URL ?? "", webOrigin: process.env.GSW_MEETINGS_WEB_ORIGIN ?? "", signingSecret: process.env.GSW_MEETINGS_SIGNING_SECRET ?? "" });
      await client.issueHost(organizer, { meetingId: id });
      await createOwnerCode(id, accountId, userId, start);
      counts.created++;
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status === 403 || status === 404) counts.skipped++; else counts.failed++;
    }
  };
  try {
    const candidates = await pool.query<{ meeting_url: string; account_id: string; user_id: string; starts_at: Date }>(`
      SELECT DISTINCT b.meeting_url,b.account_id,l.user_id,b.starts_at FROM event_bookings b JOIN event_links l ON l.id=b.link_id
      WHERE b.status='confirmed' AND b.ends_at>now() AND b.meeting_url IS NOT NULL
      UNION SELECT DISTINCT r.meeting_link,r.account_id,a.user_id,r.event_start FROM calendar_rsvps r JOIN email_accounts a ON a.id=r.account_id
      WHERE COALESCE(r.event_end,r.event_start+interval '1 hour')>now() AND r.meeting_link IS NOT NULL`);
    for (const row of candidates.rows) await ensure(row.meeting_url, row.account_id, row.user_id, row.starts_at.toISOString());
    let cursor = "00000000-0000-0000-0000-000000000000";
    for (;;) {
      const { rows } = await pool.query<{ id: string; user_id: string; auth_user_id: string }>("SELECT a.id,a.user_id,u.auth_user_id FROM email_accounts a JOIN users u ON u.id=a.user_id JOIN mailbox_credential_vault v ON v.account_id=a.id WHERE a.id>$1 AND a.account_status='active' AND u.user_status='active' AND u.auth_user_id IS NOT NULL ORDER BY a.id LIMIT 25", [cursor]);
      if (!rows.length) break;
      for (const row of rows) {
        try {
          await meetingOrganizer(row.user_id, row.id);
          const engine = await getUserEngine({ productUserId: row.user_id, authUserId: row.auth_user_id, accountId: row.id, headers: {}, permission: "manage" });
          const events = await engine.listCalendarEvents(row.id, new Date(Date.now() - 86400000).toISOString(), new Date(Date.now() + 366 * 86400000).toISOString());
          counts.mailboxesScanned++;
          for (const event of events) {
            const start = meetingStartUtc(event.start, event.timeZone ?? "Etc/UTC");
            const end = event.end ? meetingStartUtc(event.end, event.timeZone ?? "Etc/UTC") : new Date(Date.parse(start) + 3600000).toISOString();
            if (Date.parse(end) > Date.now()) await ensure(event.meetingLink ?? null, row.id, row.user_id, start);
          }
        } catch { counts.mailboxesUnavailable++; }
      }
      cursor = rows[rows.length - 1]!.id;
    }
    return counts;
  } finally {
    await lock.query("SELECT pg_advisory_unlock(hashtext('meeting-owner-code-backfill'))");
    lock.release();
  }
}
