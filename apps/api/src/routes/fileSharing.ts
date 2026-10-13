import { createHash, randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { and, eq, gt, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import { assets, fileNodes, fileShares, users } from "../db/schema.js";
import { createR2PresignedUrl } from "../files/r2.js";
import { requireUser } from "../auth/middleware.js";
import { notFound, forbidden } from "../lib/errors.js";

const hash = (token: string) => createHash("sha256").update(token).digest("hex");
const safeAssetId = z.string().uuid();
const newShare = z.object({
  scope: z.enum(["anyone", "email"]),
  email: z.string().email().max(320).optional(),
  expiresAt: z.string().datetime().optional(),
}).refine(x => x.scope === "anyone" ? !x.email : Boolean(x.email), { message: "Recipient email is required for restricted sharing" });
const normalize = (address: string) => address.trim().toLowerCase();
const active = (share: { revokedAt: Date | null; expiresAt: Date | null }) =>
  !share.revokedAt && (!share.expiresAt || share.expiresAt > new Date());
const ownedFile = async (userId: string, assetId: string) => {
  const [file] = await db.select({ id: assets.id, r2Key: assets.r2Key, filename: assets.filename,
    mimeType: assets.mimeType, sizeBytes: assets.sizeBytes }).from(assets)
    .where(and(eq(assets.id, assetId), eq(assets.userId, userId), eq(assets.status, "ready"), isNull(assets.deletedAt))).limit(1);
  if (!file) throw notFound("file not found");
  const [node] = await db.select({ trashedAt: fileNodes.trashedAt }).from(fileNodes)
    .where(eq(fileNodes.assetId, assetId)).limit(1);
  if (node?.trashedAt) throw notFound("file not found");
  return file;
};
const accessibleFile = async (share: typeof fileShares.$inferSelect) => {
  if (!active(share)) throw notFound("share not found");
  return ownedFile(share.ownerUserId, share.assetId);
};
const signed = (key: string) => createR2PresignedUrl({ method: "GET", key, expiresSeconds: 60 });
const downloadHeaders = (reply: { header: (name: string, value: string) => unknown }) => {
  reply.header("cache-control", "private, no-store");
  reply.header("referrer-policy", "no-referrer");
  reply.header("x-content-type-options", "nosniff");
};

/**
 * R2 remains private. Sharing grants access to specific assets, not to the
 * bucket, owner prefix, or any other files.
 */
export default async function fileSharingRoutes(app: FastifyInstance) {
  app.get<{ Params: { token: string } }>("/s/:token", {
    config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
  }, async (req, reply) => {
    const token = z.string().regex(/^[0-9a-f]{64}$/).parse(req.params.token);
    const [share] = await db.select().from(fileShares).where(and(eq(fileShares.scope, "anyone"), eq(fileShares.tokenHash, hash(token)))).limit(1);
    if (!share) throw notFound("share not found");
    const file = await accessibleFile(share);
    downloadHeaders(reply);
    return reply.redirect(signed(file.r2Key));
  });

  await app.register(async protectedRoutes => {
    await requireUser(protectedRoutes, { optional: false });
    protectedRoutes.post<{ Params: { assetId: string } }>("/product/files/:assetId/shares", async (req, reply) => {
      const assetId = safeAssetId.parse(req.params.assetId);
      const input = newShare.parse(req.body);
      await ownedFile(req.user!.id, assetId);
      const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
      if (expiresAt && expiresAt <= new Date()) return reply.code(400).send({ error: "Expiration must be in the future" });
      const token = input.scope === "anyone" ? randomBytes(32).toString("hex") : null;
      const [share] = await db.insert(fileShares).values({
        ownerUserId: req.user!.id, assetId,
        scope: input.scope,
        recipientEmail: input.scope === "email" ? normalize(input.email!) : null,
        tokenHash: token ? hash(token) : null,
        permission: "viewer", expiresAt,
      }).returning();
      if (!share) throw new Error("Could not create file share");
      reply.code(201);
      return { share: { id: share.id, scope: share.scope, recipientEmail: share.recipientEmail, permission: "viewer", expiresAt: share.expiresAt },
        ...(token ? { path: `/s/${token}` } : {}) };
    });

    protectedRoutes.get<{ Params: { assetId: string } }>("/product/files/:assetId/shares", async req => {
      const assetId = safeAssetId.parse(req.params.assetId);
      await ownedFile(req.user!.id, assetId);
      const grants = await db.select({
        id: fileShares.id, scope: fileShares.scope, recipientEmail: fileShares.recipientEmail,
        permission: fileShares.permission, expiresAt: fileShares.expiresAt, revokedAt: fileShares.revokedAt, createdAt: fileShares.createdAt,
      }).from(fileShares).where(and(eq(fileShares.ownerUserId, req.user!.id), eq(fileShares.assetId, assetId)));
      return { grants };
    });

    protectedRoutes.delete<{ Params: { assetId: string; shareId: string } }>("/product/files/:assetId/shares/:shareId", async (req, reply) => {
      const assetId = safeAssetId.parse(req.params.assetId);
      const shareId = safeAssetId.parse(req.params.shareId);
      await ownedFile(req.user!.id, assetId);
      const [revoked] = await db.update(fileShares).set({ revokedAt: new Date() })
        .where(and(eq(fileShares.id, shareId), eq(fileShares.ownerUserId, req.user!.id), eq(fileShares.assetId, assetId)))
        .returning({ id: fileShares.id });
      if (!revoked) throw notFound("share not found");
      return { revoked: true };
    });

    protectedRoutes.get("/product/files/shared-with-me", async req => {
      const [verified] = await db.select({ email: users.email, verified: users.emailVerified })
        .from(users).where(eq(users.id, req.user!.id)).limit(1);
      if (!verified?.verified) return { files: [] };
      const shares = await db.select({ id: fileShares.id, assetId: fileShares.assetId,
        ownerUserId: fileShares.ownerUserId, expiresAt: fileShares.expiresAt, revokedAt: fileShares.revokedAt })
        .from(fileShares).where(and(eq(fileShares.scope, "email"), eq(fileShares.recipientEmail, normalize(verified.email))));
      const files = [];
      for (const share of shares) {
        try {
          const file = await accessibleFile({ ...share, scope: "email" } as typeof fileShares.$inferSelect);
          files.push({ shareId: share.id, filename: file.filename, mimeType: file.mimeType, sizeBytes: file.sizeBytes });
        } catch { /* Revoked or deleted objects are not presented. */ }
      }
      return { files };
    });

    protectedRoutes.get<{ Params: { shareId: string } }>("/product/files/shares/:shareId/download", async (req, reply) => {
      const shareId = safeAssetId.parse(req.params.shareId);
      const [verified] = await db.select({ email: users.email, verified: users.emailVerified })
        .from(users).where(eq(users.id, req.user!.id)).limit(1);
      if (!verified?.verified) throw forbidden("verified email required");
      const [share] = await db.select().from(fileShares)
        .where(and(eq(fileShares.id, shareId), eq(fileShares.scope, "email"), eq(fileShares.recipientEmail, normalize(verified.email)))).limit(1);
      if (!share) throw notFound("share not found");
      const file = await accessibleFile(share);
      downloadHeaders(reply);
      return reply.redirect(signed(file.r2Key));
    });
  });
}
