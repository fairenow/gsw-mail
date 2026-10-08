import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { config } from "../config.js";
import { db } from "../db/client.js";
import { assets, fileNodes, userStorageQuotas } from "../db/schema.js";
import { badRequest, notFound, serviceUnavailable } from "../lib/errors.js";
import { createR2PresignedUrl, deleteR2Object, headR2Object, putR2Object, r2Configured } from "./r2.js";

const ACTIVE_STORAGE_STATUSES = ["upload_pending", "ready"] as const;

const safeFilename = (value: string): string => {
  const cleaned = value
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\\/]/g, "_")
    .trim()
    .slice(0, 240);
  return cleaned || "file";
};

const extensionFor = (filename: string): string | null => {
  const match = /\.([a-z0-9]{1,20})$/i.exec(filename);
  return match?.[1]?.toLowerCase() ?? null;
};

const classifyKind = (mimeType: string): string => {
  if (mimeType === "application/pdf") return "pdf";
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  if (/wordprocessingml|msword/.test(mimeType)) return "document";
  if (/spreadsheetml|ms-excel|csv/.test(mimeType)) return "spreadsheet";
  if (/presentationml|ms-powerpoint/.test(mimeType)) return "presentation";
  return "file";
};

const userPrefix = (userId: string): string =>
  createHash("sha256").update(userId).digest("hex").slice(0, 24);

export async function getOrCreateStorageQuota(userId: string) {
  await db.insert(userStorageQuotas).values({
    userId,
    planKey: "free",
    quotaBytes: config.files.freeQuotaBytes,
  }).onConflictDoNothing();

  const [row] = await db.select().from(userStorageQuotas).where(eq(userStorageQuotas.userId, userId)).limit(1);
  if (!row) throw new Error("storage quota unavailable");
  return row;
}

export async function storageUsage(userId: string) {
  const quota = await getOrCreateStorageQuota(userId);
  const [usage] = await db.select({
    bytes: sql<string>`coalesce(sum(${assets.sizeBytes}), 0)::text`,
  }).from(assets).where(and(
    eq(assets.userId, userId),
    inArray(assets.status, [...ACTIVE_STORAGE_STATUSES]),
    isNull(assets.deletedAt),
  ));
  const usedBytes = Number(usage?.bytes ?? 0);
  return {
    planKey: quota.planKey,
    quotaBytes: Number(quota.quotaBytes),
    usedBytes,
    availableBytes: Math.max(0, Number(quota.quotaBytes) - usedBytes),
  };
}

export async function createUploadIntent(input: {
  userId: string;
  filename: string;
  mimeType?: string | undefined;
  sizeBytes: number;
  source?: string | undefined;
  kind?: string | undefined;
  parentId?: string | null | undefined;
}) {
  if (!r2Configured()) throw serviceUnavailable("File storage is not configured yet.");
  if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes < 1) throw badRequest("file size must be greater than zero");
  if (input.sizeBytes > config.files.maxUploadBytes) throw badRequest(`file exceeds the ${config.files.maxUploadBytes} byte upload limit`);

  const usage = await storageUsage(input.userId);
  if (input.sizeBytes > usage.availableBytes) throw badRequest("storage quota exceeded");

  if (input.parentId) {
    const [parent] = await db.select({ id: fileNodes.id }).from(fileNodes).where(and(
      eq(fileNodes.id, input.parentId),
      eq(fileNodes.userId, input.userId),
      eq(fileNodes.nodeType, "folder"),
      isNull(fileNodes.trashedAt),
    )).limit(1);
    if (!parent) throw badRequest("destination folder not found");
  }

  const id = randomUUID();
  const filename = safeFilename(input.filename);
  const mimeType = input.mimeType?.trim().slice(0, 255) || "application/octet-stream";
  const key = `users/${userPrefix(input.userId)}/assets/${id}/original/${filename}`;

  const [asset] = await db.insert(assets).values({
    id,
    userId: input.userId,
    r2Key: key,
    filename,
    displayName: filename,
    mimeType,
    extension: extensionFor(filename),
    sizeBytes: input.sizeBytes,
    kind: input.kind?.trim().slice(0, 80) || classifyKind(mimeType),
    source: input.source?.trim().slice(0, 80) || "user_upload",
    status: "upload_pending",
  }).returning();
  if (!asset) throw new Error("failed to create asset");

  await db.insert(fileNodes).values({
    userId: input.userId,
    assetId: asset.id,
    parentId: input.parentId ?? null,
    name: filename,
    nodeType: "file",
  });

  return {
    asset,
    upload: {
      method: "PUT" as const,
      url: createR2PresignedUrl({ method: "PUT", key, expiresSeconds: config.r2.presignTtlSeconds }),
      expiresInSeconds: config.r2.presignTtlSeconds,
      headers: {},
    },
    usage,
  };
}

export async function completeUpload(userId: string, assetId: string) {
  const [asset] = await db.select().from(assets).where(and(
    eq(assets.id, assetId),
    eq(assets.userId, userId),
    eq(assets.status, "upload_pending"),
    isNull(assets.deletedAt),
  )).limit(1);
  if (!asset) throw notFound("pending asset not found");

  const object = await headR2Object(asset.r2Key);
  if (!object) throw badRequest("uploaded object was not found");
  if (object.size !== Number(asset.sizeBytes)) {
    throw badRequest(`uploaded object size did not match the declared size (${object.size} != ${asset.sizeBytes})`);
  }

  const [ready] = await db.update(assets).set({
    status: "ready",
    etag: object.etag,
    mimeType: object.contentType || asset.mimeType,
    updatedAt: new Date(),
  }).where(and(eq(assets.id, asset.id), eq(assets.userId, userId))).returning();
  return ready!;
}

export async function listFiles(userId: string, parentId?: string | null) {
  return db.select({
    id: fileNodes.id,
    parentId: fileNodes.parentId,
    name: fileNodes.name,
    nodeType: fileNodes.nodeType,
    starred: fileNodes.starred,
    trashedAt: fileNodes.trashedAt,
    createdAt: fileNodes.createdAt,
    updatedAt: fileNodes.updatedAt,
    assetId: assets.id,
    filename: assets.filename,
    mimeType: assets.mimeType,
    sizeBytes: assets.sizeBytes,
    kind: assets.kind,
    source: assets.source,
    status: assets.status,
  }).from(fileNodes)
    .leftJoin(assets, eq(fileNodes.assetId, assets.id))
    .where(and(
      eq(fileNodes.userId, userId),
      parentId ? eq(fileNodes.parentId, parentId) : isNull(fileNodes.parentId),
      isNull(fileNodes.trashedAt),
    ))
    .orderBy(desc(fileNodes.updatedAt));
}

export async function createFolder(userId: string, name: string, parentId?: string | null) {
  const folderName = safeFilename(name);
  if (parentId) {
    const [parent] = await db.select({ id: fileNodes.id }).from(fileNodes).where(and(
      eq(fileNodes.id, parentId),
      eq(fileNodes.userId, userId),
      eq(fileNodes.nodeType, "folder"),
      isNull(fileNodes.trashedAt),
    )).limit(1);
    if (!parent) throw notFound("parent folder not found");
  }
  const [folder] = await db.insert(fileNodes).values({
    userId,
    parentId: parentId ?? null,
    name: folderName,
    nodeType: "folder",
  }).returning();
  return folder!;
}

export async function getAssetForUser(userId: string, assetId: string) {
  const [asset] = await db.select().from(assets).where(and(
    eq(assets.id, assetId),
    eq(assets.userId, userId),
    eq(assets.status, "ready"),
    isNull(assets.deletedAt),
  )).limit(1);
  if (!asset) throw notFound("asset not found");
  return asset;
}

export async function createDownloadUrl(userId: string, assetId: string) {
  const asset = await getAssetForUser(userId, assetId);
  return {
    assetId: asset.id,
    filename: asset.filename,
    mimeType: asset.mimeType,
    sizeBytes: Number(asset.sizeBytes),
    url: createR2PresignedUrl({ method: "GET", key: asset.r2Key, expiresSeconds: config.r2.presignTtlSeconds }),
    expiresInSeconds: config.r2.presignTtlSeconds,
  };
}

export async function deleteAsset(userId: string, assetId: string) {
  const [asset] = await db.select().from(assets).where(and(
    eq(assets.id, assetId),
    eq(assets.userId, userId),
    isNull(assets.deletedAt),
  )).limit(1);
  if (!asset) throw notFound("asset not found");

  await deleteR2Object(asset.r2Key);
  await db.transaction(async (tx) => {
    await tx.update(assets).set({ status: "deleted", deletedAt: new Date(), updatedAt: new Date() }).where(eq(assets.id, asset.id));
    await tx.update(fileNodes).set({ trashedAt: new Date(), updatedAt: new Date() }).where(eq(fileNodes.assetId, asset.id));
  });
  return { id: asset.id, deleted: true };
}


export async function createAssetFromBuffer(input: {
  userId: string;
  filename: string;
  mimeType?: string | undefined;
  content: Buffer;
  source?: string | undefined;
  kind?: string | undefined;
  addToFiles?: boolean | undefined;
}) {
  if (!r2Configured()) throw serviceUnavailable("File storage is not configured yet.");
  const sizeBytes = input.content.byteLength;
  if (sizeBytes < 1) throw badRequest("file size must be greater than zero");
  if (sizeBytes > config.files.maxUploadBytes) throw badRequest(`file exceeds the ${config.files.maxUploadBytes} byte upload limit`);

  const usage = await storageUsage(input.userId);
  if (sizeBytes > usage.availableBytes) throw badRequest("storage quota exceeded");

  const id = randomUUID();
  const filename = safeFilename(input.filename);
  const mimeType = input.mimeType?.trim().slice(0, 255) || "application/octet-stream";
  const key = `users/${userPrefix(input.userId)}/assets/${id}/original/${filename}`;

  const [asset] = await db.insert(assets).values({
    id,
    userId: input.userId,
    r2Key: key,
    filename,
    displayName: filename,
    mimeType,
    extension: extensionFor(filename),
    sizeBytes,
    kind: input.kind?.trim().slice(0, 80) || classifyKind(mimeType),
    source: input.source?.trim().slice(0, 80) || "user_upload",
    status: "upload_pending",
  }).returning();
  if (!asset) throw new Error("failed to create asset");

  try {
    const uploaded = await putR2Object(key, input.content, mimeType);
    const [ready] = await db.update(assets).set({
      status: "ready",
      etag: uploaded.etag,
      updatedAt: new Date(),
    }).where(eq(assets.id, asset.id)).returning();

    if (input.addToFiles) {
      await db.insert(fileNodes).values({
        userId: input.userId,
        assetId: asset.id,
        parentId: null,
        name: filename,
        nodeType: "file",
      }).onConflictDoNothing();
    }

    return ready!;
  } catch (error) {
    await db.update(assets).set({ status: "deleted", deletedAt: new Date(), updatedAt: new Date() }).where(eq(assets.id, asset.id));
    await deleteR2Object(key).catch(() => undefined);
    throw error;
  }
}
