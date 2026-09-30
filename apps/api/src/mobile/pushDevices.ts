import { and, desc, eq, sql } from "drizzle-orm";
import { boolean, integer, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { db } from "../db/client.js";

const mobilePushDevices = pgTable("mobile_push_devices", {
  expoPushToken: text("expo_push_token").notNull(),
  userId: text("user_id").notNull(),
  platform: text("platform").notNull(),
  deviceName: text("device_name"),
  appVersion: text("app_version"),
  mailEnabled: boolean("mail_enabled").default(true).notNull(),
  calendarEnabled: boolean("calendar_enabled").default(true).notNull(),
  calendarReminderMinutes: integer("calendar_reminder_minutes").default(15).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.userId, table.expoPushToken] }),
}));

let ensureTablePromise: Promise<unknown> | undefined;
async function ensureTable(): Promise<void> {
  ensureTablePromise ??= db.execute(sql`
    CREATE TABLE IF NOT EXISTS "mobile_push_devices" (
      "expo_push_token" text NOT NULL,
      "user_id" text NOT NULL,
      "platform" text NOT NULL,
      "device_name" text,
      "app_version" text,
      "mail_enabled" boolean DEFAULT true NOT NULL,
      "calendar_enabled" boolean DEFAULT true NOT NULL,
      "calendar_reminder_minutes" integer DEFAULT 15 NOT NULL,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL,
      "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
      PRIMARY KEY ("user_id", "expo_push_token")
    );
    ALTER TABLE "mobile_push_devices" ADD COLUMN IF NOT EXISTS "mail_enabled" boolean DEFAULT true NOT NULL;
    ALTER TABLE "mobile_push_devices" ADD COLUMN IF NOT EXISTS "calendar_enabled" boolean DEFAULT true NOT NULL;
    ALTER TABLE "mobile_push_devices" ADD COLUMN IF NOT EXISTS "calendar_reminder_minutes" integer DEFAULT 15 NOT NULL;

    DO $$
    DECLARE
      pk_name text;
      pk_columns text[];
    BEGIN
      SELECT c.conname, array_agg(a.attname ORDER BY keys.ordinality)
        INTO pk_name, pk_columns
      FROM pg_constraint c
      JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS keys(attnum, ordinality) ON true
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = keys.attnum
      WHERE c.conrelid = 'mobile_push_devices'::regclass AND c.contype = 'p'
      GROUP BY c.conname;

      IF pk_columns = ARRAY['expo_push_token']::text[] THEN
        EXECUTE format('ALTER TABLE "mobile_push_devices" DROP CONSTRAINT %I', pk_name);
        ALTER TABLE "mobile_push_devices"
          ADD CONSTRAINT "mobile_push_devices_pkey" PRIMARY KEY ("user_id", "expo_push_token");
      ELSIF pk_columns IS NULL THEN
        ALTER TABLE "mobile_push_devices"
          ADD CONSTRAINT "mobile_push_devices_pkey" PRIMARY KEY ("user_id", "expo_push_token");
      END IF;
    END $$;
  `);
  await ensureTablePromise;
}

export type MobilePushDevice = {
  expoPushToken: string;
  platform: "ios" | "android";
  deviceName?: string | undefined;
  appVersion?: string | undefined;
  mailEnabled: boolean;
  calendarEnabled: boolean;
  calendarReminderMinutes: number;
  updatedAt: string;
};

export type MobileNotificationPreferences = Pick<MobilePushDevice, "mailEnabled" | "calendarEnabled" | "calendarReminderMinutes">;

export async function upsertMobilePushDevice(input: {
  userId: string;
  expoPushToken: string;
  platform: "ios" | "android";
  deviceName?: string | undefined;
  appVersion?: string | undefined;
  mailEnabled?: boolean | undefined;
  calendarEnabled?: boolean | undefined;
  calendarReminderMinutes?: number | undefined;
}): Promise<void> {
  await ensureTable();
  await db.insert(mobilePushDevices).values({
    expoPushToken: input.expoPushToken,
    userId: input.userId,
    platform: input.platform,
    deviceName: input.deviceName ?? null,
    appVersion: input.appVersion ?? null,
    mailEnabled: input.mailEnabled ?? true,
    calendarEnabled: input.calendarEnabled ?? true,
    calendarReminderMinutes: input.calendarReminderMinutes ?? 15,
    updatedAt: new Date(),
  }).onConflictDoUpdate({
    target: [mobilePushDevices.userId, mobilePushDevices.expoPushToken],
    set: {
      platform: input.platform,
      deviceName: input.deviceName ?? null,
      appVersion: input.appVersion ?? null,
      ...(input.mailEnabled !== undefined ? { mailEnabled: input.mailEnabled } : {}),
      ...(input.calendarEnabled !== undefined ? { calendarEnabled: input.calendarEnabled } : {}),
      ...(input.calendarReminderMinutes !== undefined ? { calendarReminderMinutes: input.calendarReminderMinutes } : {}),
      updatedAt: new Date(),
    },
  });
}

export async function updateMobilePushDevicePreferences(userId: string, expoPushToken: string, preferences: Partial<MobileNotificationPreferences>): Promise<void> {
  await ensureTable();
  await db.update(mobilePushDevices).set({ ...preferences, updatedAt: new Date() }).where(and(eq(mobilePushDevices.userId, userId), eq(mobilePushDevices.expoPushToken, expoPushToken)));
}

export async function removeMobilePushDevice(userId: string, expoPushToken: string): Promise<void> {
  await ensureTable();
  await db.delete(mobilePushDevices).where(and(eq(mobilePushDevices.userId, userId), eq(mobilePushDevices.expoPushToken, expoPushToken)));
}

export async function listMobilePushDevices(userId: string): Promise<MobilePushDevice[]> {
  await ensureTable();
  const rows = await db.select().from(mobilePushDevices).where(eq(mobilePushDevices.userId, userId)).orderBy(desc(mobilePushDevices.updatedAt));
  return rows.map((row) => ({
    expoPushToken: row.expoPushToken,
    platform: row.platform === "android" ? "android" : "ios",
    ...(row.deviceName ? { deviceName: row.deviceName } : {}),
    ...(row.appVersion ? { appVersion: row.appVersion } : {}),
    mailEnabled: row.mailEnabled,
    calendarEnabled: row.calendarEnabled,
    calendarReminderMinutes: row.calendarReminderMinutes,
    updatedAt: row.updatedAt.toISOString(),
  }));
}
