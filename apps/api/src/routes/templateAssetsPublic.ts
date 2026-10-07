import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { emailTemplates } from "../db/schema.js";
import { notFound } from "../lib/errors.js";

export default async function templateAssetsPublic(app: FastifyInstance) {
  app.get<{ Params: { id: string } }>("/product/template-assets/:id/logo", async (req, reply) => {
    const [template] = await db.select({
      mimeType: emailTemplates.logoMimeType,
      base64: emailTemplates.logoBase64,
    }).from(emailTemplates).where(eq(emailTemplates.id, req.params.id)).limit(1);
    if (!template?.base64 || !template.mimeType) throw notFound("template logo not found");

    reply.header("content-type", template.mimeType);
    reply.header("cache-control", "public, max-age=3600, stale-while-revalidate=86400");
    return reply.send(Buffer.from(template.base64, "base64"));
  });
}
