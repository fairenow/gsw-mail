import type { FastifyInstance } from "fastify";
import { requireUser } from "../auth/middleware.js";
import { DEFAULT_MAIL_TEMPLATE_KEY, MAIL_TEMPLATE_CATALOG } from "../mail/templates/index.js";

export default async function templateRoutes(app: FastifyInstance) {
  await requireUser(app, { optional: false });

  app.get("/product/templates", async () => ({
    defaultTemplateKey: DEFAULT_MAIL_TEMPLATE_KEY,
    templates: MAIL_TEMPLATE_CATALOG,
  }));
}
