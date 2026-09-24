import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser } from "../auth/middleware.js";
import { sendPushToUser } from "../mobile/expoPush.js";
import { listMobilePushDevices, removeMobilePushDevice, updateMobilePushDevicePreferences, upsertMobilePushDevice } from "../mobile/pushDevices.js";

const preferenceSchema = z.object({
  mailEnabled: z.boolean().optional(),
  calendarEnabled: z.boolean().optional(),
  calendarReminderMinutes: z.number().int().min(0).max(1440).optional(),
});

const pushDeviceSchema = z.object({
  expoPushToken: z.string().trim().min(10).max(512),
  platform: z.enum(["ios", "android"]),
  deviceName: z.string().trim().max(200).optional(),
  appVersion: z.string().trim().max(80).optional(),
}).merge(preferenceSchema);

export default async (app: FastifyInstance) => {
  await requireUser(app, { optional: false });

  app.get("/product/push-devices", async (req) => ({
    devices: await listMobilePushDevices(req.user!.id),
  }));

  app.post("/product/push-devices", async (req, reply) => {
    const input = pushDeviceSchema.parse(req.body);
    await upsertMobilePushDevice({ userId: req.user!.id, ...input });
    reply.code(201);
    return { registered: true };
  });

  app.patch<{ Params: { token: string } }>("/product/push-devices/:token/preferences", async (req) => {
    const input = preferenceSchema.parse(req.body);
    const preferences = {
      ...(input.mailEnabled !== undefined ? { mailEnabled: input.mailEnabled } : {}),
      ...(input.calendarEnabled !== undefined ? { calendarEnabled: input.calendarEnabled } : {}),
      ...(input.calendarReminderMinutes !== undefined ? { calendarReminderMinutes: input.calendarReminderMinutes } : {}),
    };
    await updateMobilePushDevicePreferences(req.user!.id, req.params.token, preferences);
    return { updated: true, preferences };
  });

  app.post("/product/push-devices/test", async (req) => {
    return sendPushToUser({
      userId: req.user!.id,
      title: "GSW Mail notifications are ready",
      body: "This device is connected for native notifications.",
      data: { route: "mail", kind: "push-test" },
      channelId: "mail",
      category: "general",
      checkReceipts: true,
    });
  });

  app.delete<{ Params: { token: string } }>("/product/push-devices/:token", async (req) => {
    await removeMobilePushDevice(req.user!.id, req.params.token);
    return { removed: true };
  });
};
