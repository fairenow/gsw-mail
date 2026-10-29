import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { mobileCalendarDiscoverySql, mobileCompletionDiscoverySql, mobileNotificationSchemaSql } from "./notificationWorker.js";

test("notification discovery durably deduplicates, isolates users, honors preferences, and schedules at-start reminders",async()=>{
  const db=new PGlite();
  try {
    await db.exec(`CREATE TABLE users(id text PRIMARY KEY,status text);CREATE TABLE email_accounts(id uuid PRIMARY KEY,user_id text,status text);
      CREATE TABLE mobile_push_devices(user_id text,expo_push_token text,created_at timestamptz DEFAULT now()-interval '1 minute',calendar_enabled boolean DEFAULT true,chat_enabled boolean DEFAULT true,scheduled_work_enabled boolean DEFAULT true,work_attention_enabled boolean DEFAULT true,calendar_reminder_minutes integer DEFAULT 15);
      CREATE TABLE ai_idempotency_keys(id uuid DEFAULT gen_random_uuid(),user_id text,account_id uuid,tool_name text,status text,result jsonb,completed_at timestamptz,updated_at timestamptz);
      CREATE TABLE ai_automations(id uuid PRIMARY KEY,user_id text,account_id uuid,title text);
      CREATE TABLE ai_automation_runs(id uuid DEFAULT gen_random_uuid(),automation_id uuid,status text,conversation_id uuid,completed_at timestamptz);
      CREATE TABLE ai_tasks(id uuid DEFAULT gen_random_uuid(),user_id text,account_id uuid,conversation_id uuid,title text,status text,completed_at timestamptz,updated_at timestamptz);
      CREATE TABLE calendar_email_reminders(account_id uuid,event_id text,event_title text,event_start timestamptz,status text);`);
    await db.exec(mobileNotificationSchemaSql);
    await db.exec(`UPDATE mobile_notification_rollout SET started_at=now()-interval '30 seconds';
      INSERT INTO users VALUES('user-a','active'),('user-b','active');
      INSERT INTO mobile_push_devices(user_id,expo_push_token) VALUES('user-a','device-a'),('user-b','device-b');
      INSERT INTO ai_idempotency_keys(user_id,tool_name,status,result,completed_at,updated_at) VALUES('user-a','chat.command','completed','{"conversationId":"chat-a"}',now(),now()),('user-b','chat.command','completed','{"conversationId":"chat-b"}',now(),now()),('user-a','chat.command','completed','{}',now()-interval '1 day',now()-interval '1 day');
      UPDATE mobile_push_devices SET chat_enabled=false WHERE user_id='user-b';
      INSERT INTO ai_automations VALUES('11111111-1111-4111-8111-111111111111','user-a',NULL,'Scheduled task');
      INSERT INTO ai_automation_runs(automation_id,status,completed_at) VALUES('11111111-1111-4111-8111-111111111111','completed',now()),('11111111-1111-4111-8111-111111111111','failed',now());`);
    await db.exec(mobileCompletionDiscoverySql);
    await db.exec(mobileCompletionDiscoverySql);
    const completed=await db.query<{user_id:string;category:string;data:{conversationId?:string}}>("SELECT user_id,category,data FROM mobile_notification_outbox");
    assert.equal(completed.rows.length,3);
    assert.ok(completed.rows.every(row=>row.user_id==='user-a'));
    assert.deepEqual(completed.rows.map(row=>row.category).sort(),['chat','scheduledWork','workAttention']);
    assert.equal(completed.rows.find(row=>row.category==='chat')?.data.conversationId,'chat-a');
    await db.exec(`INSERT INTO email_accounts VALUES('22222222-2222-4222-8222-222222222222','user-a','active');
      INSERT INTO mobile_calendar_events(user_id,account_id,event_id,event_title,event_start) VALUES('user-a','22222222-2222-4222-8222-222222222222','at-start','Meeting',now()-interval '10 seconds'),('user-a','22222222-2222-4222-8222-222222222222','cancelled','Cancelled meeting',now()+interval '15 minutes'-interval '10 seconds');
      UPDATE mobile_calendar_events SET cancelled=true WHERE event_id='cancelled';
      UPDATE mobile_push_devices SET calendar_reminder_minutes=0 WHERE user_id='user-a';`);
    await db.exec(mobileCalendarDiscoverySql);
    await db.exec(mobileCalendarDiscoverySql);
    const calendar=await db.query<{data:{eventId:string;reminderMinutes:number}}>("SELECT data FROM mobile_notification_outbox WHERE category='calendar'");
    assert.equal(calendar.rows.length,1);
    assert.equal(calendar.rows[0]!.data.eventId,'at-start');
    assert.equal(calendar.rows[0]!.data.reminderMinutes,0);
    await db.exec(`UPDATE mobile_push_devices SET calendar_reminder_minutes=15 WHERE user_id='user-a'; INSERT INTO mobile_calendar_events(user_id,account_id,event_id,event_title,event_start) VALUES('user-a','22222222-2222-4222-8222-222222222222','before-start','Future meeting',now()+interval '15 minutes'-interval '10 seconds');`);
    await db.exec(mobileCalendarDiscoverySql);
    const future=await db.query<{count:number}>("SELECT count(*)::int AS count FROM mobile_notification_outbox WHERE category='calendar'");
    assert.equal(future.rows[0]!.count,2);
  }finally{await db.close();}
});
