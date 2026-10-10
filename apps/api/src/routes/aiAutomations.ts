import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAccountPermission } from "../auth/authorize.js";
import { requireUser } from "../auth/middleware.js";
import {
  createAutomation,
  deleteAutomation,
  getAutomation,
  listAutomationRuns,
  listAutomations,
  updateAutomation,
} from "../ai/automationService.js";

const scheduleSchema = z.object({
  frequency: z.enum(["once", "daily", "weekdays", "weekends", "weekly", "monthly"]),
  hour: z.number().int().min(0).max(23),
  minute: z.number().int().min(0).max(59),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  dayOfMonth: z.number().int().min(1).max(31).optional(),
  interval: z.number().int().min(1).max(365).optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export default async function aiAutomationRoutes(app: FastifyInstance) {
  await requireUser(app, { optional: false });

  app.post("/product/automations", async (req, reply) => {
    const input = z.object({
      accountId: z.string().uuid(),
      title: z.string().trim().min(1).max(120),
      instruction: z.string().trim().min(1).max(20_000),
      timeZone: z.string().trim().min(1).max(100),
      schedule: scheduleSchema,
    }).parse(req.body);
    await requireAccountPermission(req.user!.id, input.accountId, "read");
    const automation = await createAutomation({
      userId: req.user!.id,
      accountId: input.accountId,
      title: input.title,
      instruction: input.instruction,
      timeZone: input.timeZone,
      schedule: input.schedule,
      allowedScopes: ["mail.read"],
    });
    reply.code(201);
    return { automation };
  });

  app.get("/product/automations", async (req) => {
    return { automations: await listAutomations(req.user!.id) };
  });

  app.get("/product/automations/:id", async (req) => {
    const params = z.object({ id: z.string().uuid() }).parse(req.params);
    const automation = await getAutomation(req.user!.id, params.id);
    if (automation.accountId) await requireAccountPermission(req.user!.id, automation.accountId, "read");
    return { automation };
  });

  app.get("/product/automations/:id/runs", async (req) => {
    const params = z.object({ id: z.string().uuid() }).parse(req.params);
    const query = z.object({ limit: z.coerce.number().int().min(1).max(100).optional() }).parse(req.query);
    const automation = await getAutomation(req.user!.id, params.id);
    if (automation.accountId) await requireAccountPermission(req.user!.id, automation.accountId, "read");
    return { runs: await listAutomationRuns(req.user!.id, params.id, query.limit ?? 25) };
  });

  app.patch("/product/automations/:id", async (req) => {
    const params = z.object({ id: z.string().uuid() }).parse(req.params);
    const existing = await getAutomation(req.user!.id, params.id);
    if (existing.accountId) await requireAccountPermission(req.user!.id, existing.accountId, "read");
    const input = z.object({
      title: z.string().trim().min(1).max(120).optional(),
      instruction: z.string().trim().min(1).max(20_000).optional(),
      status: z.enum(["active", "paused", "archived"]).optional(),
      timeZone: z.string().trim().min(1).max(100).optional(),
      schedule: scheduleSchema.optional(),
    }).parse(req.body);
    return { automation: await updateAutomation(req.user!.id, params.id, input) };
  });

  app.delete("/product/automations/:id", async (req) => {
    const params = z.object({ id: z.string().uuid() }).parse(req.params);
    const existing = await getAutomation(req.user!.id, params.id);
    if (existing.accountId) await requireAccountPermission(req.user!.id, existing.accountId, "read");
    return { deleted: await deleteAutomation(req.user!.id, params.id) };
  });
}
