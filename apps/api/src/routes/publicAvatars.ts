import { signedAssetEdgeUrl } from "../files/edgeDelivery.js";
import type { FastifyInstance } from "fastify";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import { assets, userSettings, users } from "../db/schema.js";
import { requireUser } from "../auth/middleware.js";
import { createR2PresignedUrl } from "../files/r2.js";
import { notFound } from "../lib/errors.js";

const isPublished = (general: Record<string, unknown>) => general.profileImagePublic === true;
const getProfileId = (general: Record<string, unknown>) =>
  typeof general.profileImageAssetId === "string" ? general.profileImageAssetId : null;

// This route never makes a user's file library public. Only a specifically
// opted-in, owned, ready image asset can be served.
export async function publicAvatars(app: FastifyInstance) {
  app.get<{ Params: { id: string } }>("/public/avatars/:id", async (req, reply) => {
    const id = z.string().parse(req.params.id);
    const [setting] = await db.select().from(userSettings).where(eq(userSettings.userId, id)).limit(1);
    if (!setting || !isPublished(setting.general)) throw notFound("Avatar not published");
    const assetId = getProfileId(setting.general);
    if (!assetId) throw notFound("Avatar not published");
    const [asset] = await db.select({ r2Key: assets.r2Key, mimeType: assets.mimeType }).from(assets)
      .where(and(eq(assets.id, assetId), eq(assets.userId, id), eq(assets.status, "ready"), sql`${assets.deletedAt} is null`)).limit(1);
    if (!asset || !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(asset.mimeType))
      throw notFound("Avatar not published");
    reply.header("cache-control", "public, max-age=60");
    return reply.redirect(signedAssetEdgeUrl({ key: asset.r2Key, width: 128 }) ?? createR2PresignedUrl({ method: "GET", key: asset.r2Key, expiresSeconds: 300 }));
  });
}

export async function avatarLookup(app: FastifyInstance) {
  await requireUser(app, { optional: false });
  app.post("/product/avatars/lookup", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req) => {
    const { emails } = z.object({ emails: z.array(z.string().email().max(320)).min(1).max(30) }).parse(req.body);
    const normalized = [...new Set(emails.map(value => value.trim().toLowerCase()))];
    const matches = await db.select({ email: users.email, userId: users.id, general: userSettings.general })
      .from(users).innerJoin(userSettings, eq(userSettings.userId, users.id))
      .where(inArray(sql<string>`lower(${users.email})`, normalized));
    const avatars: Record<string, string> = {};
    for (const item of matches) {
      if (isPublished(item.general) && getProfileId(item.general))
        avatars[item.email.toLowerCase()] = `/public/avatars/${encodeURIComponent(item.userId)}`;
    }
    return { avatars };
  });
}
