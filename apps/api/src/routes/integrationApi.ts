import { createMailboxOperations, mailboxOperations, operationSchema } from "../integrations/operations.js";
import { getAiCapabilitySettings } from "../ai/capabilities.js";
import { getAiProvider } from "../ai/providers/index.js";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z, ZodError } from "zod";
import { HttpError } from "../lib/errors.js";
import { idempotencySchema, integrationSendSchema, IntegrationError } from "../integrations/contract.js";
import { integrationService } from "../integrations/service.js";
import type { IntegrationPrincipal } from "../integrations/service.js";

export async function integrationApi(app: FastifyInstance, options: { service?: typeof integrationService; operations?: typeof mailboxOperations } = {}) {
  const service = options.service ?? integrationService;
  const principals = new WeakMap<FastifyRequest, IntegrationPrincipal>();
  app.setErrorHandler((error, req, reply) => {
    const status = error instanceof IntegrationError ? error.status : error instanceof ZodError ? 400 : error instanceof HttpError ? error.status : (error as { statusCode?: number }).statusCode ?? 500;
    const code = error instanceof IntegrationError ? error.code : status === 400 ? "invalid_request" : status === 413 ? "payload_too_large" : status === 415 ? "unsupported_media_type" : status === 429 ? "rate_limit_exceeded" : "service_unavailable";
    if (status >= 500) req.log.error({ requestId: req.id, code }, "integration request failed");
    if (status === 401) reply.header("WWW-Authenticate", 'Bearer realm="GSW Mailbox API"').header("Link", '<https://mail-docs.guidedstepswellness.com/#authentication>; rel="help"');
    if (status === 429) reply.header("Retry-After", code === "daily_limit_reached" ? String(Math.ceil((Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate() + 1) - Date.now()) / 1000)) : "60");
    return reply.code(status).send({ error: { code, requestId: req.id, retryable: error instanceof IntegrationError ? error.retryable : status >= 500 || status === 429 } });
  });
  app.addHook("onRequest", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    principals.set(req, await service.authenticate(req.headers.authorization));
  });
  const operations = options.operations ?? createMailboxOperations({ service });
  app.get("/integrations/v1/capabilities", async () => ({ access: "mailbox.full", operations: operations.capabilities() }));
  app.post("/integrations/v1/operations", { bodyLimit: 1024 * 1024 }, async (req) => {
    const key = req.headers["idempotency-key"] === undefined ? undefined : idempotencySchema.parse(req.headers["idempotency-key"]);
    return operations.execute(principals.get(req)!, operationSchema.parse(req.body), key);
  });
  app.post("/integrations/v1/ai/chat", { bodyLimit: 256 * 1024 }, async req => {
    const input = z.object({ messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(50000) }).strict()).min(1).max(50) }).strict().parse(req.body);
    const principal = principals.get(req)!;
    const row = await service.installation(principal.installationId);
    if (row.installation.testMode) return { simulated: true, content: null, model: null };
    const ctx = await service.context(principal);
    const settings = await getAiCapabilitySettings(ctx.userId);
    if (!settings.enabled) throw new IntegrationError(403, "mailbox_ai_disabled");
    const result = await getAiProvider(settings.modelProvider).run({ messages: input.messages });
    return { content: result.content, model: result.model };
  });
  app.get("/integrations/v1/connection", async req => service.connection(principals.get(req)!));
  app.post("/integrations/v1/emails", { bodyLimit: 256 * 1024 }, async (req, reply) => {
    const key = idempotencySchema.parse(req.headers["idempotency-key"]);
    const result = await service.submit(principals.get(req)!, integrationSendSchema.parse(req.body), key);
    reply.header("Location", `/integrations/v1/emails/${result.id}`).code(202);
    return { ...result, status: result.testMode ? "simulated" : "accepted_for_processing", requestId: req.id };
  });
  app.get<{ Params: { id: string } }>("/integrations/v1/emails/:id", async req => service.status(principals.get(req)!, z.string().uuid().parse(req.params.id)));
}
export default integrationApi;
