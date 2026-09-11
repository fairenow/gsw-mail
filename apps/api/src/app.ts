import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import { ZodError } from "zod";
import { requireUser } from "./auth/middleware.js";
import { HttpError } from "./lib/errors.js";
import accounts from "./routes/accounts.js";
import admin from "./routes/admin.js";
import aliases from "./routes/aliases.js";
import drafts from "./routes/drafts.js";
import messages from "./routes/messages.js";
import search from "./routes/search.js";
import send from "./routes/send.js";
import sends from "./routes/sends.js";
import suppressions from "./routes/suppressions.js";
import threads from "./routes/threads.js";
import webhooks from "./routes/webhooks.js";

export function buildApp() {
  const app = Fastify({ logger: true });

  app.register(cors, { origin: true });
  app.register(rateLimit, { max: 120, timeWindow: "1 minute" });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof HttpError) {
      return reply.code(error.status).send({ error: error.message });
    }
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: "invalid request", issues: error.issues });
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
  app.register(threads);
  app.register(search);
  app.register(send);
  app.register(sends);
  app.register(drafts);
  app.register(admin);
  app.register(suppressions);
  app.register(webhooks);

  return app;
}