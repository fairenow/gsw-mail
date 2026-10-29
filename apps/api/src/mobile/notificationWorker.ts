import { createHash } from "node:crypto";
import { pool } from "../db/client.js";
import { requireAccountPermission } from "../auth/authorize.js";
import { sendPushToUser } from "./expoPush.js";
import { ensureMobilePushDeviceSchema } from "./pushDevices.js";
import { calendarStartInstant, type PushCategory } from "./notificationPolicy.js";

export const mobileCalendarDiscoverySql=`
    INSERT INTO mobile_calendar_events(user_id,account_id,event_id,event_title,event_start)
    SELECT DISTINCT ON(a.user_id,r.account_id,r.event_id) a.user_id,r.account_id,r.event_id,r.event_title,r.event_start
    FROM calendar_email_reminders r JOIN email_accounts a ON a.id=r.account_id
    WHERE a.user_id IS NOT NULL AND a.status='active' AND r.event_start>now() AND r.status IN ('pending','sending','sent')
    ORDER BY a.user_id,r.account_id,r.event_id,r.event_start DESC ON CONFLICT DO NOTHING;
    INSERT INTO mobile_notification_outbox(id,user_id,account_id,expo_push_token,category,title,body,data,expires_at)
    SELECT 'calendar:'||c.user_id||':'||c.account_id||':'||c.event_id||':'||extract(epoch FROM c.event_start)||':'||d.calendar_reminder_minutes||':'||md5(d.expo_push_token),
      c.user_id,c.account_id,d.expo_push_token,'calendar','Upcoming calendar event',left(c.event_title,180),
      jsonb_build_object('route','calendar','kind','calendar-reminder','eventId',c.event_id,'accountId',c.account_id,'userId',c.user_id,'eventStart',c.event_start,'reminderMinutes',d.calendar_reminder_minutes),CASE WHEN d.calendar_reminder_minutes=0 THEN c.event_start+interval '5 minutes' ELSE c.event_start END
    FROM mobile_calendar_events c JOIN mobile_push_devices d ON d.user_id=c.user_id JOIN users u ON u.id=c.user_id AND u.status='active'
    WHERE d.calendar_enabled=true AND c.cancelled=false AND c.event_start>=now()-interval '5 minutes' AND c.event_start-make_interval(mins=>d.calendar_reminder_minutes)<=now()
      AND c.event_start-make_interval(mins=>d.calendar_reminder_minutes)>=now()-interval '5 minutes'
    ON CONFLICT(id) DO NOTHING;
  `;
export const mobileCompletionDiscoverySql=`
    WITH source AS (
      SELECT 'chat:'||k.id||':'||k.status AS source_id,k.user_id,k.account_id,
        CASE WHEN k.status='completed' THEN 'chat' ELSE 'workAttention' END AS category,
        CASE WHEN k.status='completed' THEN 'GSW Chat is ready' ELSE 'GSW Chat needs attention' END AS title,
        'Open the conversation to review the saved result or status.' AS body,
        jsonb_strip_nulls(jsonb_build_object('route','chat','kind','chat-result','conversationId',k.result->>'conversationId','accountId',k.account_id,'userId',k.user_id)) AS data,
        coalesce(k.completed_at,k.updated_at) AS occurred_at
      FROM ai_idempotency_keys k WHERE k.tool_name='chat.command' AND k.status IN ('completed','uncertain')
      UNION ALL
      SELECT 'automation:'||r.id,a.user_id,a.account_id,
        CASE WHEN r.status='completed' THEN 'scheduledWork' ELSE 'workAttention' END,
        CASE WHEN r.status='completed' THEN 'Scheduled work completed' ELSE 'Scheduled work needs attention' END,
        left(a.title,180),jsonb_strip_nulls(jsonb_build_object('route','tasks','kind','automation-result','automationId',a.id,'runId',r.id,'conversationId',r.conversation_id,'accountId',a.account_id,'userId',a.user_id)),r.completed_at
      FROM ai_automation_runs r JOIN ai_automations a ON a.id=r.automation_id WHERE r.status IN ('completed','failed')
      UNION ALL
      SELECT 'task:'||t.id||':'||t.status,t.user_id,t.account_id,
        CASE WHEN t.status='completed' THEN 'scheduledWork' ELSE 'workAttention' END,
        CASE WHEN t.status='completed' THEN 'Background work completed' ELSE 'Background work needs attention' END,
        left(t.title,180),jsonb_strip_nulls(jsonb_build_object('route','chat','kind','task-result','taskId',t.id,'conversationId',t.conversation_id,'accountId',t.account_id,'userId',t.user_id)),coalesce(t.completed_at,t.updated_at)
      FROM ai_tasks t WHERE t.status IN ('completed','failed','waiting')
    )
    INSERT INTO mobile_notification_outbox(id,user_id,account_id,expo_push_token,category,title,body,data,expires_at)
    SELECT s.source_id||':'||s.user_id||':'||md5(d.expo_push_token),s.user_id,s.account_id,d.expo_push_token,s.category,s.title,s.body,s.data,s.occurred_at+interval '24 hours'
    FROM source s JOIN mobile_push_devices d ON d.user_id=s.user_id JOIN users u ON u.id=s.user_id AND u.status='active' CROSS JOIN mobile_notification_rollout rollout
    WHERE s.occurred_at>=greatest(d.created_at,rollout.started_at,now()-interval '24 hours')
      AND CASE s.category WHEN 'chat' THEN d.chat_enabled WHEN 'scheduledWork' THEN d.scheduled_work_enabled ELSE d.work_attention_enabled END
    ON CONFLICT(id) DO NOTHING;
  `;
export const mobileNotificationSchemaSql=`
    CREATE TABLE IF NOT EXISTS mobile_notification_rollout (id integer PRIMARY KEY CHECK(id=1), started_at timestamptz NOT NULL DEFAULT now());
    INSERT INTO mobile_notification_rollout(id) VALUES(1) ON CONFLICT DO NOTHING;
    CREATE TABLE IF NOT EXISTS mobile_calendar_events (
      user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      account_id uuid NOT NULL REFERENCES email_accounts(id) ON DELETE CASCADE,
      event_id text NOT NULL,event_title text NOT NULL,event_start timestamptz NOT NULL,cancelled boolean NOT NULL DEFAULT false,
      PRIMARY KEY(user_id,account_id,event_id)
    );
    CREATE INDEX IF NOT EXISTS mobile_calendar_events_start_idx ON mobile_calendar_events(event_start);
    CREATE TABLE IF NOT EXISTS mobile_notification_outbox (
      id text PRIMARY KEY,user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      account_id uuid REFERENCES email_accounts(id) ON DELETE CASCADE,expo_push_token text NOT NULL,
      category text NOT NULL,title text NOT NULL,body text NOT NULL,data jsonb NOT NULL,
      status text NOT NULL DEFAULT 'pending',attempts integer NOT NULL DEFAULT 0,
      due_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL,
      claimed_at timestamptz,accepted_at timestamptz,last_error text,created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS mobile_notification_outbox_due_idx ON mobile_notification_outbox(due_at) WHERE status='pending';
  `;


export async function ensureMobileNotificationSchema() {
  await ensureMobilePushDeviceSchema();
  await pool.query(mobileNotificationSchemaSql);
}

export async function syncCalendarPushEvents(userId:string,accountId:string,events:readonly {engineId:string;title:string;start:string;timeZone?:string|undefined}[],range?:{after:string;before:string}) {
  const client=await pool.connect();
  try {
    await client.query("BEGIN");
    if(range) await client.query("UPDATE mobile_calendar_events SET cancelled=true WHERE user_id=$1 AND account_id=$2 AND event_start >= $3 AND event_start < $4 AND NOT(event_id=ANY($5::text[]))",[userId,accountId,range.after,range.before,events.map(event=>event.engineId)]);
    for(const event of events) {
      const start=calendarStartInstant(event.start,event.timeZone);
      await client.query(`INSERT INTO mobile_calendar_events(user_id,account_id,event_id,event_title,event_start) VALUES($1,$2,$3,$4,$5)
        ON CONFLICT(user_id,account_id,event_id) DO UPDATE SET event_title=EXCLUDED.event_title,event_start=EXCLUDED.event_start,cancelled=false`,[userId,accountId,event.engineId,event.title,start]);
    }
    await client.query("COMMIT");
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}
export async function cancelCalendarPushEvent(accountId:string,eventId:string) {
  await pool.query("UPDATE mobile_calendar_events SET cancelled=true WHERE account_id=$1 AND event_id=$2",[accountId,eventId]);
}

export async function discoverMobileNotifications() {
  await pool.query(mobileCompletionDiscoverySql);
  await pool.query(mobileCalendarDiscoverySql);
}

type NotificationJob={id:string;user_id:string;account_id:string|null;expo_push_token:string;category:PushCategory;title:string;body:string;data:Record<string,string|number|boolean|null>;attempts:number};
export function createMobileNotificationWorker(options:{send?:typeof sendPushToUser;onError?:(error:unknown)=>void;intervalMs?:number}={}) {
  let running=false;
  let timer:ReturnType<typeof setInterval>|undefined;
  const send=options.send??sendPushToUser;
  const runOnce=async()=>{
    if(running)return 0;
    running=true;
    try {
      await discoverMobileNotifications();
      await pool.query("UPDATE mobile_notification_outbox SET status='pending',due_at=now(),last_error='Delivery lease expired' WHERE status='sending' AND claimed_at<now()-interval '5 minutes' AND attempts<5");
      await pool.query("UPDATE mobile_notification_outbox SET status='expired' WHERE (status='pending' AND expires_at<=now()) OR (status IN ('pending','sending') AND attempts>=5 AND claimed_at<now()-interval '5 minutes')");
      const jobs=await pool.query<NotificationJob>(`WITH due AS (SELECT id FROM mobile_notification_outbox WHERE status='pending' AND due_at<=now() AND expires_at>now() AND attempts<5 ORDER BY due_at LIMIT 20 FOR UPDATE SKIP LOCKED)
        UPDATE mobile_notification_outbox o SET status='sending',claimed_at=now(),attempts=attempts+1 FROM due WHERE o.id=due.id RETURNING o.*`);
      for(const job of jobs.rows) {
        try {
          const user=await pool.query("SELECT id FROM users WHERE id=$1 AND status='active'",[job.user_id]);
          let allowed=Boolean(user.rowCount);
          if(job.account_id) {
            try { await requireAccountPermission(job.user_id,job.account_id,"read"); }
            catch { allowed=false; }
          }
          if(allowed && job.category==="calendar") {
            const event=await pool.query(`SELECT c.event_id FROM mobile_calendar_events c JOIN mobile_push_devices d ON d.user_id=c.user_id WHERE c.cancelled=false AND c.user_id=$1 AND c.account_id=$2 AND c.event_id=$3 AND c.event_start=$4 AND d.expo_push_token=$5 AND d.calendar_reminder_minutes=$6`,[job.user_id,job.account_id,job.data.eventId,job.data.eventStart,job.expo_push_token,job.data.reminderMinutes]);
            allowed=Boolean(event.rowCount);
          }
          if(!allowed) {await pool.query("UPDATE mobile_notification_outbox SET status='skipped' WHERE id=$1",[job.id]);continue;}
          const result=await send({userId:job.user_id,title:job.title,body:job.body,data:{...job.data,notificationId:createHash("sha256").update(job.id).digest("hex")},category:job.category,targetToken:job.expo_push_token,channelId:job.category==="calendar"?"calendar":"work",traceId:createHash("sha256").update(job.id).digest("hex").slice(0,16)});
          if(result.attempted && !result.accepted)throw new Error("Expo did not accept notification");
          await pool.query("UPDATE mobile_notification_outbox SET status=$2,accepted_at=CASE WHEN $2='accepted' THEN now() ELSE NULL END,last_error=NULL WHERE id=$1",[job.id,result.accepted?"accepted":"skipped"]);
        }catch(error){
          await pool.query("UPDATE mobile_notification_outbox SET status=$2,due_at=now()+make_interval(secs=>$3),last_error=$4 WHERE id=$1",[job.id,job.attempts>=5?"failed":"pending",Math.min(900,30*2**job.attempts),error instanceof Error?error.message.slice(0,500):"Push delivery failed"]);
          options.onError?.(error);
        }
      }
      await pool.query("DELETE FROM mobile_notification_outbox WHERE created_at<now()-interval '30 days'; DELETE FROM mobile_calendar_events WHERE event_start<now()-interval '2 days'");
      return jobs.rowCount??0;
    }finally{running=false;}
  };
  return {runOnce,start(){if(timer)return;const tick=()=>{void runOnce().catch(error=>options.onError?.(error));};timer=setInterval(tick,options.intervalMs??10000);timer.unref();tick();},stop(){if(timer)clearInterval(timer);timer=undefined;}};
}
