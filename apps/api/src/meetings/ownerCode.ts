import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { pool } from "../db/client.js";
import { meetingOrganizer } from "./access.js";
import { createMeetingClient } from "./client.js";

export const HOST_CODE_SCHEMA = `
CREATE TABLE IF NOT EXISTS meeting_owner_codes (
 meeting_id text PRIMARY KEY, account_id uuid NOT NULL REFERENCES email_accounts(id) ON DELETE CASCADE,
 user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE, nonce uuid NOT NULL,
 expires_at timestamptz NOT NULL, attempts integer NOT NULL DEFAULT 0, consumed_at timestamptz
);
CREATE INDEX IF NOT EXISTS meeting_owner_codes_expiry_idx ON meeting_owner_codes(expires_at);
`;
type CodeRow = { meeting_id: string; account_id: string; user_id: string; nonce: string; expires_at: Date; attempts: number; consumed_at: Date | null };
function codeFor(row: CodeRow) {
  const secret = process.env.GSW_MEETINGS_SIGNING_SECRET ?? "";
  if (Buffer.byteLength(secret) < 32) throw Error("Meeting signing configuration unavailable");
  const digest = createHmac("sha256", secret).update(JSON.stringify(["owner-code-v1", row.meeting_id, row.account_id, row.user_id, row.nonce])).digest("hex");
  return String(parseInt(digest.slice(0, 12), 16) % 100000000).padStart(8, "0");
}
export async function createOwnerCode(meetingId: string, accountId: string, userId: string, scheduledAt: string) {
  const expiry = new Date(Math.max(Date.now(), new Date(scheduledAt).getTime()) + 24 * 60 * 60 * 1000);
  if (!Number.isFinite(expiry.getTime())) throw Error("Invalid meeting schedule");
  const { rows } = await pool.query<CodeRow>(
    "INSERT INTO meeting_owner_codes(meeting_id,account_id,user_id,nonce,expires_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(meeting_id) DO UPDATE SET expires_at=GREATEST(meeting_owner_codes.expires_at,EXCLUDED.expires_at) WHERE meeting_owner_codes.account_id=EXCLUDED.account_id AND meeting_owner_codes.user_id=EXCLUDED.user_id RETURNING *",
    [meetingId, accountId, userId, randomUUID(), expiry],
  );
  if (!rows[0]) throw Error("Meeting owner mismatch");
  return { ownerCode: codeFor(rows[0]), ownerCodeExpiresAt: rows[0].expires_at.toISOString() };
}
export async function bookingOwnerCode(meetingUrl: string | null, accountId: string, userId: string) {
  if (!meetingUrl) return undefined;
  const url = new URL(meetingUrl);
  if (url.origin !== process.env.GSW_MEETINGS_WEB_ORIGIN) return undefined;
  const id = /^\/meet\/([a-zA-Z0-9_-]{1,200})$/.exec(url.pathname)?.[1];
  if (!id) return undefined;
  const { rows } = await pool.query<CodeRow>("SELECT * FROM meeting_owner_codes WHERE meeting_id=$1 AND account_id=$2 AND user_id=$3 AND consumed_at IS NULL AND attempts<10 AND expires_at>now()", [id, accountId, userId]);
  return rows[0] ? codeFor(rows[0]) : undefined;
}
export async function redeemOwnerCode(meetingId: string, code: string) {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const { rows } = await db.query<CodeRow>("UPDATE meeting_owner_codes SET attempts=attempts+1 WHERE meeting_id=$1 AND consumed_at IS NULL AND attempts<10 AND expires_at>now() RETURNING *", [meetingId]);
    const row = rows[0];
    if (!row || !timingSafeEqual(Buffer.from(codeFor(row)), Buffer.from(code))) {
      await db.query("COMMIT");
      return null;
    }
    const organizer = await meetingOrganizer(row.user_id, row.account_id);
    const client = createMeetingClient({ apiUrl: process.env.GSW_MEETINGS_API_URL ?? "", webOrigin: process.env.GSW_MEETINGS_WEB_ORIGIN ?? "", signingSecret: process.env.GSW_MEETINGS_SIGNING_SECRET ?? "" });
    const result = await client.issueHost(organizer, { meetingId });
    await db.query("UPDATE meeting_owner_codes SET consumed_at=now() WHERE meeting_id=$1", [meetingId]);
    await db.query("COMMIT");
    return { ticket: result.ticket, meetingId: result.meetingId, expiresAt: result.expiresAt };
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally { db.release(); }
}
