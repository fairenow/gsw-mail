import type { FastifyInstance, FastifyRequest } from "fastify";
import { z, ZodError } from "zod";
import { HttpError } from "../lib/errors.js";
import { idempotencySchema, integrationSendSchema, IntegrationError } from "../integrations/contract.js";
import { integrationService } from "../integrations/service.js";
import type { IntegrationPrincipal } from "../integrations/service.js";

export async function integrationApi(app: FastifyInstance, options: { service?: typeof integrationService } = {}) {
  const service = options.service ?? integrationService;
  const principals = new WeakMap<FastifyRequest, IntegrationPrincipal>();
  app.setErrorHandler((error, req, reply) => {
    const status = error instanceof IntegrationError ? error.status : error instanceof ZodError ? 400 : error instanceof HttpError ? error.status : (error as { statusCode?: number }).statusCode ?? 500;
    const code = error instanceof IntegrationError ? error.code : status === 400 ? "invalid_request" : status === 413 ? "payload_too_large" : status === 415 ? "unsupported_media_type" : status === 429 ? "rate_limit_exceeded" : "service_unavailable";
    if (status >= 500) req.log.error({ requestId: req.id, code }, "integration request failed");
    if (status === 429) reply.header("Retry-After", code === "daily_limit_reached" ? String(Math.ceil((Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate() + 1) - Date.now()) / 1000)) : "60");
    return reply.code(status).send({ error: { code, requestId: req.id, retryable: error instanceof IntegrationError ? error.retryable : status >= 500 || status === 429 } });
  });
  app.addHook("onRequest", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    principals.set(req, await service.authenticate(req.headers.authorization));
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
