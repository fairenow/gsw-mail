import { randomUUID } from "node:crypto";
import { pool } from "../db/client.js";
import { getRelay } from "../outbound/relay.js";

export const DEFAULT_EMAIL_REMINDERS = [1440, 30] as const;

export function reminderDueAt(eventStart: string, minutesBefore: number): Date {
  const start = new Date(eventStart);
  if (!Number.isFinite(start.getTime()) || !Number.isInteger(minutesBefore) || minutesBefore < 1 || minutesBefore > 10080) throw new Error("Invalid reminder schedule");
  return new Date(start.getTime() - minutesBefore * 60_000);
}

export async function ensureCalendarEmailReminderSchema(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS calendar_email_reminders (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      account_id uuid NOT NULL REFERENCES email_accounts(id) ON DELETE CASCADE,
      event_id text NOT NULL,
      event_title text NOT NULL,
      event_start timestamptz NOT NULL,
      minutes_before integer NOT NULL CHECK (minutes_before BETWEEN 1 AND 10080),
      due_at timestamptz NOT NULL,
      status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','sent','cancelled','failed')),
      attempts integer NOT NULL DEFAULT 0,
      claimed_at timestamptz,
      sent_at timestamptz,
      last_error text,
      UNIQUE(account_id,event_id,minutes_before)
    );
    CREATE INDEX IF NOT EXISTS calendar_email_reminders_due_idx ON calendar_email_reminders(due_at) WHERE status='pending';
  `);
}

export async function replaceEventEmailReminders(input: {
  accountId: string; eventId: string; title: string; start: string; minutes?: number[];
}): Promise<void> {
  const start = new Date(input.start);
  if (!Number.isFinite(start.getTime())) throw new Error("Invalid calendar event start");
  const minutes = [...new Set(input.minutes ?? [...DEFAULT_EMAIL_REMINDERS])];
  if (minutes.length > 8 || minutes.some(m => !Number.isInteger(m) || m < 1 || m > 10080)) throw new Error("Invalid email reminder interval");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM calendar_email_reminders WHERE account_id=$1 AND event_id=$2 AND status IN ('pending','failed')", [input.accountId,input.eventId]);
    for (const m of minutes) {
      const due = reminderDueAt(input.start, m);
      if (due.getTime() <= Date.now()) continue;
      await client.query(`INSERT INTO calendar_email_reminders(account_id,event_id,event_title,event_start,minutes_before,due_at)
        VALUES($1,$2,$3,$4,$5,$6)
        ON CONFLICT(account_id,event_id,minutes_before) DO UPDATE SET
          event_title=EXCLUDED.event_title,event_start=EXCLUDED.event_start,due_at=EXCLUDED.due_at,
          status='pending',claimed_at=NULL,last_error=NULL
        WHERE calendar_email_reminders.status <> 'sent'`,
        [input.accountId,input.eventId,input.title,start,m,due]);
    }
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

export async function cancelEventEmailReminders(accountId:string,eventId:string):Promise<void> {
  await pool.query("UPDATE calendar_email_reminders SET status='cancelled' WHERE account_id=$1 AND event_id=$2 AND status IN ('pending','failed')",[accountId,eventId]);
}

export async function deliverDueCalendarEmailReminders(): Promise<number> {
  const client=await pool.connect();
  let rows: Array<{id:string;account_id:string;address:string;event_title:string;event_start:Date;minutes_before:number}>=[];
  try {
    await client.query("BEGIN");
    const result=await client.query<{id:string;account_id:string;address:string;event_title:string;event_start:Date;minutes_before:number}>(`
      SELECT r.id,r.account_id,a.address,r.event_title,r.event_start,r.minutes_before
      FROM calendar_email_reminders r JOIN email_accounts a ON a.id=r.account_id
      WHERE r.status='pending' AND r.due_at<=now()
      ORDER BY r.due_at LIMIT 10 FOR UPDATE OF r SKIP LOCKED`);
    rows=result.rows;
    for(const row of rows) await client.query("UPDATE calendar_email_reminders SET status='sending',claimed_at=now(),attempts=attempts+1 WHERE id=$1",[row.id]);
    await client.query("COMMIT");
  } catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
  for(const row of rows) {
    try {
      const result=await getRelay().send({
        id:randomUUID(),accountId:row.account_id,fromAddress:row.address,to:[row.address],
        subject:`Calendar reminder: ${row.event_title}`,
        textBody:`Reminder: ${row.event_title}\nStarts: ${row.event_start.toISOString()}\nThis reminder was scheduled ${row.minutes_before} minutes before the event.`
      });
      if(!result.accepted) throw new Error(result.message ?? "Email relay did not accept reminder");
      await pool.query("UPDATE calendar_email_reminders SET status='sent',sent_at=now() WHERE id=$1",[row.id]);
    } catch(error){
      // Do not blindly retry uncertain relay outcomes: this prevents duplicate reminder emails.
      await pool.query("UPDATE calendar_email_reminders SET status='failed',last_error=$2 WHERE id=$1",[row.id,error instanceof Error?error.message:String(error)]);
      console.error("[calendar:reminder] delivery failed",{id:row.id,error});
    }
  }
  return rows.length;
}
