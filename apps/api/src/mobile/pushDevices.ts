import { and, desc, eq, sql } from "drizzle-orm";
import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { db } from "../db/client.js";

const mobilePushDevices = pgTable("mobile_push_devices", {
  expoPushToken: text("expo_push_token").primaryKey(),
  userId: text("user_id").notNull(),
  platform: text("platform").notNull(),
  deviceName: text("device_name"),
  appVersion: text("app_version"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

let ensureTablePromise: Promise<unknown> | undefined;
async function ensureTable(): Promise<void> {
  ensureTablePromise ??= db.execute(sql`
    CREATE TABLE IF NOT EXISTS "mobile_push_devices" (
      "expo_push_token" text PRIMARY KEY,
      "user_id" text NOT NULL,
      "platform" text NOT NULL,
      "device_name" text,
      "app_version" text,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL,
      "updated_at" timestamp with time zone DEFAULT now() NOT NULL
    )
  `);
  await ensureTablePromise;
}

export type MobilePushDevice = {
  expoPushToken: string;
  platform: "ios" | "android";
  deviceName?: string | undefined;
  appVersion?: string | undefined;
  updatedAt: string;
};

export async function upsertMobilePushDevice(input: {
  userId: string;
  expoPushToken: string;
  platform: "ios" | "android";
  deviceName?: string | undefined;
  appVersion?: string | undefined;
}): Promise<void> {
  await ensureTable();
  await db.insert(mobilePushDevices).values({
    expoPushToken: input.expoPushToken,
    userId: input.userId,
    platform: input.platform,
    deviceName: input.deviceName ?? null,
    appVersion: input.appVersion ?? null,
    updatedAt: new Date(),
  }).onConflictDoUpdate({
    target: mobilePushDevices.expoPushToken,
    set: {
      userId: input.userId,
      platform: input.platform,
      deviceName: input.deviceName ?? null,
      appVersion: input.appVersion ?? null,
      updatedAt: new Date(),
    },
  });
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
    updatedAt: row.updatedAt.toISOString(),
  }));
}
