import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { assets, emailTemplates } from "../db/schema.js";
import { createR2PresignedUrl } from "../files/r2.js";
import { notFound } from "../lib/errors.js";

export default async function templateAssetsPublic(app: FastifyInstance) {
  app.get<{ Params: { id: string } }>("/product/template-assets/:id/logo", async (req, reply) => {
    const [template] = await db.select({
      mimeType: emailTemplates.logoMimeType,
      base64: emailTemplates.logoBase64,
      assetId: emailTemplates.logoAssetId,
    }).from(emailTemplates).where(eq(emailTemplates.id, req.params.id)).limit(1);

    if (template?.assetId) {
      const [asset] = await db.select({
        r2Key: assets.r2Key,
        status: assets.status,
      }).from(assets).where(eq(assets.id, template.assetId)).limit(1);
      if (asset?.status === "ready") {
        reply.header("cache-control", "public, max-age=300, stale-while-revalidate=3600");
        return reply.redirect(createR2PresignedUrl({ method: "GET", key: asset.r2Key, expiresSeconds: 900 }));
      }
    }

    if (!template?.base64 || !template.mimeType) throw notFound("template logo not found");
    reply.header("content-type", template.mimeType);
    reply.header("cache-control", "public, max-age=3600, stale-while-revalidate=86400");
    return reply.send(Buffer.from(template.base64, "base64"));
  });
}
