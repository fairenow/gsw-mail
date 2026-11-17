import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { pool } from "../db/client.js";
import { meetingOrganizer } from "./access.js";
import { createMeetingClient, type MeetingOrganizer } from "./client.js";
import { codeFor, type CodeRow } from "./ownerCode.js";
import { serviceUnavailable } from "../lib/errors.js";

type NativeSession = { meetingId: string; sessionToken: string; expiresAt: number; apiOrigin: string };
type NativeCodeRow = CodeRow & { native_request_id: string | null; native_session: string | null; native_expires_at: Date | null };
function sessionKey() {
  const secret = process.env.GSW_MEETINGS_SIGNING_SECRET ?? "";
  if (Buffer.byteLength(secret) < 32) throw serviceUnavailable("meeting_configuration_unavailable");
  return createHmac("sha256", secret).update("gsw-native-host-session-v1").digest();
}
function seal(session: NativeSession, requestId: string) {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", sessionKey(), iv);
  cipher.setAAD(Buffer.from(requestId));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(session), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64");
}
function unseal(value: string, requestId: string): NativeSession {
  const data = Buffer.from(value, "base64");
  if (data.length < 29 || data.length > 4096) throw serviceUnavailable("invalid_native_session");
  const decipher = createDecipheriv("aes-256-gcm", sessionKey(), data.subarray(0,12));
  decipher.setAAD(Buffer.from(requestId)); decipher.setAuthTag(data.subarray(12,28));
  return JSON.parse(Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString("utf8")) as NativeSession;
}
function apiOrigin() {
  const url = new URL(process.env.GSW_MEETINGS_API_URL ?? "");
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw serviceUnavailable("meeting_configuration_unavailable");
  return url.origin;
}
function validSession(value: NativeSession, meetingId: string) {
  return value.meetingId === meetingId && /^[a-f0-9]{64}$/.test(value.sessionToken) && Number.isFinite(value.expiresAt) && value.expiresAt > Date.now() && value.expiresAt <= Date.now() + 7200000 && value.apiOrigin === apiOrigin();
}
export async function redeemNativeOwnerCode(meetingId: string, code: string, requestId: string, dependencies: {
  authorize?: typeof meetingOrganizer;
  issueHost?: (organizer: MeetingOrganizer, meetingId: string) => Promise<{ticket:string}>;
  transport?: typeof fetch;
} = {}) {
  requestId = requestId.toLowerCase();
  const initial = await pool.query<{user_id:string;account_id:string}>("SELECT user_id,account_id FROM meeting_owner_codes WHERE meeting_id=$1", [meetingId]);
  const binding = initial.rows[0];
  if (!binding) return null;
  const organizer = await (dependencies.authorize ?? meetingOrganizer)(binding.user_id,binding.account_id);
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const { rows } = await db.query<NativeCodeRow>("SELECT * FROM meeting_owner_codes WHERE meeting_id=$1 FOR UPDATE", [meetingId]);
    const row = rows[0];
    if (!row || row.user_id !== binding.user_id || row.account_id !== binding.account_id) { await db.query("COMMIT"); return null; }
    const matches = timingSafeEqual(Buffer.from(codeFor(row)), Buffer.from(code));
    if (row.consumed_at) {
      if (matches && row.native_request_id === requestId && row.native_session && row.native_expires_at && row.native_expires_at.getTime() > Date.now()) {
        const session = unseal(row.native_session, requestId);
        if (!validSession(session, meetingId)) throw serviceUnavailable("invalid_native_session");
        await db.query("COMMIT");
        return session;
      }
      await db.query("COMMIT"); return null;
    }
    if (row.attempts >= 10 || row.expires_at.getTime() <= Date.now()) { await db.query("COMMIT"); return null; }
    await db.query("UPDATE meeting_owner_codes SET attempts=attempts+1 WHERE meeting_id=$1", [meetingId]);
    if (!matches) { await db.query("COMMIT"); return null; }
    const origin = apiOrigin();
    const client = createMeetingClient({ apiUrl: origin, webOrigin: process.env.GSW_MEETINGS_WEB_ORIGIN ?? "", signingSecret: process.env.GSW_MEETINGS_SIGNING_SECRET ?? "" });
    const grant = dependencies.issueHost ? await dependencies.issueHost(organizer,meetingId) : await client.issueHost(organizer, { meetingId });
    const response = await (dependencies.transport ?? fetch)(origin + "/integrations/gsw-mail/host/exchange", {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(10000), headers: { "content-type": "application/json" }, body: JSON.stringify({meetingId, ticket: grant.ticket}),
    });
    if (!response.ok) { await response.body?.cancel(); throw serviceUnavailable("meeting_exchange_unavailable"); }
    const text = await response.text();
    if (text.length > 4096) throw serviceUnavailable("invalid_native_session");
    const raw = JSON.parse(text) as Omit<NativeSession,"apiOrigin">;
    const session = { ...raw, apiOrigin: origin };
    if (!validSession(session, meetingId)) throw serviceUnavailable("invalid_native_session");
    await db.query("UPDATE meeting_owner_codes SET consumed_at=now(),native_request_id=$2,native_session=$3,native_expires_at=$4 WHERE meeting_id=$1", [meetingId,requestId,seal(session,requestId),new Date(session.expiresAt)]);
    await db.query("COMMIT");
    return session;
  } catch (error) { await db.query("ROLLBACK"); throw error; }
  finally { db.release(); }
}
