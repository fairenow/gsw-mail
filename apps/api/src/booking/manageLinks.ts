import { requireAccountPermission } from "../auth/authorize.js";
import { pool } from "../db/client.js";
import { ensureBookingMailboxAuthorization } from "./authorization.js";
import { badRequest,conflict,forbidden,notFound,serviceUnavailable } from "../lib/errors.js";
import { parseEventLinkRequest } from "./request.js";
import { linkUrl,withCalendarLock,type EventLinkRow } from "./service.js";
import { meetingOrganizer } from "../meetings/access.js";
type Actor={userId:string;authUserId:string|undefined;headers:Record<string,string>};
export async function listManagedEventLinks(userId:string,accountId:string){
 await requireAccountPermission(userId,accountId,"manage");
 const {rows}=await pool.query<EventLinkRow>("SELECT * FROM event_links WHERE account_id=$1 ORDER BY created_at",[accountId]);
 return {links:rows.map(r=>({id:r.id,...r.settings,url:linkUrl(r.slug)}))};
}
export async function saveManagedEventLink(actor:Actor,raw:unknown){
    const { accountId, id, settings } = parseEventLinkRequest(raw);
    const account = await requireAccountPermission(
      actor.userId,
      accountId,
      "manage",
    );
    if (account.status !== "active" || !actor.authUserId)
      throw forbidden("Sign in to the mailbox to manage event links");
    if (settings.enabled) {
      const engine = await ensureBookingMailboxAuthorization({
        productUserId: actor.userId,
        authUserId: actor.authUserId,
        accountId,
        headers: actor.headers,
      });
      const calendars = await engine.listCalendars(accountId);
      if (!calendars.some((c) => c.engineId === settings.calendarId))
        throw badRequest("Choose a calendar belonging to this mailbox");
      if (settings.generateMeeting) {
        if (process.env.GSW_MEETINGS_ENABLED !== "true")
          throw serviceUnavailable("Meeting generation is unavailable");
        await meetingOrganizer(actor.userId, accountId);
      }
    }
    try {
      return await withCalendarLock(accountId, async (db) => {
        if (id) {
          const result = await db.query<EventLinkRow>(
            "UPDATE event_links SET slug=$3,settings=$4,user_id=$5,auth_user_id=$6,updated_at=now() WHERE id=$1 AND account_id=$2 RETURNING *",
            [
              id,
              accountId,
              settings.slug,
              settings,
              actor.userId,
              actor.authUserId,
            ],
          );
          if (!result.rows[0]) throw notFound();
          return { id, url: linkUrl(settings.slug) };
        }
        const count = await db.query<{ count: string }>(
          "SELECT count(*) FROM event_links WHERE account_id=$1",
          [accountId],
        );
        if (Number(count.rows[0]?.count) >= 20)
          throw badRequest("This mailbox already has 20 event links");
        const result = await db.query<EventLinkRow>(
          "INSERT INTO event_links(account_id,user_id,auth_user_id,slug,settings) VALUES($1,$2,$3,$4,$5) RETURNING *",
          [accountId, actor.userId, actor.authUserId, settings.slug, settings],
        );
        return { id: result.rows[0]!.id, url: linkUrl(settings.slug) };
      });
    } catch (e) {
      if ((e as { code?: string }).code === "23505")
        throw conflict(
          "This booking link name is already taken. Please choose another slug.",
        );
      throw e;
    }

}
export async function listManagedBookings(userId:string,accountId:string,linkId?:string){
 await requireAccountPermission(userId,accountId,"manage");
 const {rows}=await pool.query(`SELECT b.id,b.link_id,b.name,b.email,b.starts_at,b.ends_at,b.status,b.event_id,b.settings->>'name' AS link_name FROM event_bookings b WHERE b.account_id=$1 AND ($2::uuid IS NULL OR b.link_id=$2) ORDER BY b.created_at DESC LIMIT 100`,[accountId,linkId??null]);
 return {bookings:rows};
}
