import cors from "@fastify/cors";
import formbody from "@fastify/formbody";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import { ZodError } from "zod";
import { requireUser } from "./auth/middleware.js";
import { HttpError } from "./lib/errors.js";
import accounts from "./routes/accounts.js";
import admin from "./routes/admin.js";
import aliases from "./routes/aliases.js";
import attachments from "./routes/attachments.js";
import drafts from "./routes/drafts.js";
import messages from "./routes/messages.js";
import mailActions from "./routes/mailActions.js";
import search from "./routes/search.js";
import send from "./routes/send.js";
import sends from "./routes/sends.js";
import suppressions from "./routes/suppressions.js";
import threads from "./routes/threads.js";
import webhooks from "./routes/webhooks.js";
import stalwartWebhooks from "./routes/stalwartWebhooks.js";
import product from "./routes/product.js";
import calendarSync from "./routes/calendarSync.js";
import contactSuggestions from "./routes/contactSuggestions.js";
import templates from "./routes/templates.js";
import setup from "./routes/setup.js";
import account from "./routes/account.js";
import mailboxSetup from "./routes/mailboxSetup.js";
import recovery from "./routes/recovery.js";
import pushDevices from "./routes/pushDevices.js";
import mailChanges from "./routes/mailChanges.js";
import { auth as betterAuth } from "./auth/better.js";
import { oauthProviderAuthServerMetadata, oauthProviderOpenIdConfigMetadata } from "@better-auth/oauth-provider";
import { config } from "./config.js";
import { JmapError } from "./engine/jmap.js";

const MAIL_ATTACHMENT_BODY_LIMIT = 30 * 1024 * 1024;

export function buildApp() {
  const app = Fastify({ logger: true, bodyLimit: MAIL_ATTACHMENT_BODY_LIMIT });

  app.register(cors, { origin: true });
  app.register(rateLimit, { max: 120, timeWindow: "1 minute" });
  app.register(formbody);
  const metadataResponse = async (handler: (request: Request) => Promise<Response>, req: { url: string; headers: Record<string, string | string[] | undefined> }, reply: { code: (status: number) => { header: (name: string, value: string) => unknown; send: (body: Buffer) => unknown } }) => {
    const response = await handler(new Request(`${config.auth.baseUrl}${req.url}`, { headers: req.headers as Record<string, string> }));
    const target = reply.code(response.status);
    response.headers.forEach((value, key) => target.header(key, value));
    return target.send(Buffer.from(await response.arrayBuffer()));
  };
  app.get("/api/auth/.well-known/openid-configuration", async (req, reply) => metadataResponse(oauthProviderOpenIdConfigMetadata(betterAuth), req, reply));
  app.get("/api/auth/.well-known/oauth-authorization-server", async (req, reply) => metadataResponse(oauthProviderAuthServerMetadata(betterAuth), req, reply));
  app.all("/api/auth/*", async (req, reply) => {
    const body = betterAuthBody(req);
    const request = new Request(`${config.auth.baseUrl}${req.url}`, {
      method: req.method,
      headers: req.headers as Record<string, string>,
      ...(body !== undefined ? { body } : {}),
    });
    const response = await betterAuth.handler(request);
    reply.code(response.status);
    response.headers.forEach((value, key) => reply.header(key, value));
    return reply.send(Buffer.from(await response.arrayBuffer()));
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof HttpError) {
      return reply.code(error.status).send({ error: error.message });
    }
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: "invalid request", issues: error.issues });
    }
    if (error instanceof JmapError && error.type === "mail_identity_rejected") {
      return reply.code(401).send({ error: "mail_identity_rejected" });
    }
    if ((error as { code?: string }).code === "FST_ERR_CTP_INVALID_MEDIA_TYPE") {
      return reply.code(415).send({ error: "unsupported media type" });
    }
    app.log.error(error);
    return reply.code(500).send({ error: "internal server error" });
  });

  app.register(requireUser, { optional: true }).register(async (anon) => {
    anon.get("/health", async () => ({ ok: true, service: "gsw-mail-api" }));
  });

  app.register(accounts);
  app.register(aliases);
  app.register(messages);
  app.register(attachments);
  app.register(mailActions);
  app.register(threads);
  app.register(search);
  app.register(send);
  app.register(sends);
  app.register(drafts);
  app.register(admin);
  app.register(suppressions);
  app.register(webhooks);
  app.register(stalwartWebhooks);
  app.register(product);
  app.register(calendarSync);
  app.register(contactSuggestions);
  app.register(templates);
  app.register(setup);
  app.register(account);
  app.register(mailboxSetup);
  app.register(recovery);
  app.register(pushDevices);
  app.register(mailChanges);

  return app;
}

function betterAuthBody(req: { method: string; headers: Record<string, string | string[] | undefined>; body?: unknown }): string | undefined {
  if (req.method === "GET" || req.method === "HEAD") return undefined;
  const contentType = String(req.headers["content-type"] ?? "").split(";", 1)[0]!.trim().toLowerCase();
  if (contentType === "application/x-www-form-urlencoded") {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries((req.body ?? {}) as Record<string, unknown>)) {
      if (value == null) continue;
      if (Array.isArray(value)) {
        for (const item of value) params.append(key, String(item));
      } else {
        params.set(key, String(value));
      }
    }
    return params.toString();
  }
  if (contentType === "application/json" || contentType === "") return JSON.stringify(req.body ?? {});
  if (typeof req.body === "string") return req.body;
  const error = new Error(`unsupported Better Auth content type: ${contentType || "missing"}`) as Error & { code?: string; statusCode?: number };
  error.code = "FST_ERR_CTP_INVALID_MEDIA_TYPE";
  error.statusCode = 415;
  throw error;
}
