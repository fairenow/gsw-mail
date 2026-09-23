import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser } from "../auth/middleware.js";
import { sendPushToUser } from "../mobile/expoPush.js";
import { listMobilePushDevices, removeMobilePushDevice, upsertMobilePushDevice } from "../mobile/pushDevices.js";

const pushDeviceSchema = z.object({
  expoPushToken: z.string().trim().min(10).max(512),
  platform: z.enum(["ios", "android"]),
  deviceName: z.string().trim().max(200).optional(),
  appVersion: z.string().trim().max(80).optional(),
});

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

  app.post("/product/push-devices/test", async (req) => {
    return sendPushToUser({
      userId: req.user!.id,
      title: "GSW Mail notifications are ready",
      body: "This device is connected for native mail notifications.",
      data: { route: "mail", kind: "push-test" },
      channelId: "mail",
    });
  });

  app.delete<{ Params: { token: string } }>("/product/push-devices/:token", async (req) => {
    await removeMobilePushDevice(req.user!.id, req.params.token);
    return { removed: true };
  });
};
