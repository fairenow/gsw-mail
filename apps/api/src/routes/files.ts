import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser } from "../auth/middleware.js";
import {
  completeUpload,
  createDownloadUrl,
  createFolder,
  createUploadIntent,
  deleteAsset,
  listFiles,
  listRecentFiles,
  listStarredFiles,
  listTrashedFiles,
  moveFileNode,
  permanentlyDeleteFileNode,
  renameFileNode,
  restoreFileNode,
  setFileNodeStarred,
  storageUsage,
  trashFileNode,
} from "../files/service.js";
import { verifyR2Connection } from "../files/r2.js";

const uploadIntentSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(255).optional(),
  sizeBytes: z.number().int().positive(),
  source: z.string().trim().min(1).max(80).optional(),
  kind: z.string().trim().min(1).max(80).optional(),
  parentId: z.string().uuid().nullable().optional(),
});

const folderSchema = z.object({
  name: z.string().trim().min(1).max(255),
  parentId: z.string().uuid().nullable().optional(),
});
const nodePatchSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  parentId: z.string().uuid().nullable().optional(),
  starred: z.boolean().optional(),
});

export default async function fileRoutes(app: FastifyInstance) {
  await requireUser(app, { optional: false });

  app.get("/product/files/storage-status", async () => verifyR2Connection());

  app.get("/product/files/usage", async (req) => storageUsage(req.user!.id));

  app.get("/product/files", async (req) => {
    const query = z.object({
      parentId: z.string().uuid().optional(),
      view: z.enum(["folder", "recent", "starred", "trash"]).optional(),
    }).parse(req.query);
    const view = query.view ?? "folder";
    const files = view === "recent"
      ? await listRecentFiles(req.user!.id)
      : view === "starred"
        ? await listStarredFiles(req.user!.id)
        : view === "trash"
          ? await listTrashedFiles(req.user!.id)
          : await listFiles(req.user!.id, query.parentId ?? null);
    return { files };
  });

  app.post("/product/files/folders", async (req, reply) => {
    const input = folderSchema.parse(req.body);
    const folder = await createFolder(req.user!.id, input.name, input.parentId ?? null);
    reply.code(201);
    return { folder };
  });

  app.post("/product/files/uploads", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const input = uploadIntentSchema.parse(req.body);
    const result = await createUploadIntent({
      userId: req.user!.id,
      filename: input.filename,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      source: input.source,
      kind: input.kind,
      parentId: input.parentId,
    });
    reply.code(201);
    return result;
  });

  app.post<{ Params: { id: string } }>("/product/files/:id/complete", async (req) => ({
    asset: await completeUpload(req.user!.id, req.params.id),
    usage: await storageUsage(req.user!.id),
  }));

  app.get<{ Params: { id: string } }>("/product/files/:id/download", async (req) =>
    createDownloadUrl(req.user!.id, req.params.id));

  app.get<{ Params: { id: string } }>("/product/files/:id/content", async (req, reply) => {
    const download = await createDownloadUrl(req.user!.id, req.params.id);
    return reply.redirect(download.url);
  });

  app.patch<{ Params: { id: string } }>("/product/files/nodes/:id", async (req) => {
    const input = nodePatchSchema.parse(req.body);
    let node;
    if (input.name !== undefined) node = await renameFileNode(req.user!.id, req.params.id, input.name);
    if (input.parentId !== undefined) node = await moveFileNode(req.user!.id, req.params.id, input.parentId);
    if (input.starred !== undefined) node = await setFileNodeStarred(req.user!.id, req.params.id, input.starred);
    if (!node) throw new Error("no file changes supplied");
    return { node };
  });

  app.post<{ Params: { id: string } }>("/product/files/nodes/:id/trash", async (req) => ({
    node: await trashFileNode(req.user!.id, req.params.id),
  }));

  app.post<{ Params: { id: string } }>("/product/files/nodes/:id/restore", async (req) => ({
    node: await restoreFileNode(req.user!.id, req.params.id),
  }));

  app.delete<{ Params: { id: string } }>("/product/files/nodes/:id", async (req) =>
    permanentlyDeleteFileNode(req.user!.id, req.params.id));

  app.delete<{ Params: { id: string } }>("/product/files/:id", async (req) =>
    deleteAsset(req.user!.id, req.params.id));
}
