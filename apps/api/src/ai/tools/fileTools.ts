import { and, desc, eq, ilike, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client.js";
import { assets } from "../../db/schema.js";
import { getR2Object } from "../../files/r2.js";
import { attachExistingAssetToDraft } from "../../mail/draftAttachmentStore.js";
import type { AgentExecutionContext, AgentToolDefinition, AgentToolResult } from "./types.js";

const success = <T>(ctx: AgentExecutionContext, toolCallId: string, startedAt: string, data: T): AgentToolResult<T> => ({
  ok: true,
  toolCallId,
  data,
  audit: { userId: ctx.userId, accountId: ctx.accountId, startedAt, completedAt: new Date().toISOString() },
});

const failure = (ctx: AgentExecutionContext, toolCallId: string, startedAt: string, error: unknown): AgentToolResult => ({
  ok: false,
  toolCallId,
  error: { code: "tool_failed", message: error instanceof Error ? error.message : String(error), retryable: false },
  audit: { userId: ctx.userId, accountId: ctx.accountId, startedAt, completedAt: new Date().toISOString() },
});

const listInput = z.object({ limit: z.number().int().min(1).max(100).optional() });
const searchInput = z.object({ query: z.string().trim().min(1).max(300), limit: z.number().int().min(1).max(50).optional() });
const readInput = z.object({ assetId: z.string().uuid() });
const attachInput = z.object({
  draftId: z.string().min(1).max(1000),
  assetId: z.string().uuid(),
  contentDisposition: z.enum(["attachment", "inline"]).optional(),
  contentId: z.string().max(500).optional(),
});

const serialize = (row: {
  id: string | null;
  filename: string | null;
  displayName: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  kind: string | null;
  source: string | null;
  updatedAt: Date | null;
}) => ({
  assetId: row.id,
  filename: row.displayName || row.filename,
  mimeType: row.mimeType,
  sizeBytes: Number(row.sizeBytes ?? 0),
  kind: row.kind,
  source: row.source,
  updatedAt: row.updatedAt?.toISOString() ?? null,
});

export const filesListTool: AgentToolDefinition = {
  name: "files.list",
  description: "List the user's recent files stored in GSW Files. Use this when the user refers to a file they uploaded or saved but does not provide its asset ID.",
  inputSchema: {
    type: "object",
    properties: { limit: { type: "number", minimum: 1, maximum: 100 } },
    additionalProperties: false,
  },
  requiredScopes: ["files.read"],
  risk: "read",
  async execute(ctx, rawInput, toolCallId) {
    const startedAt = new Date().toISOString();
    try {
      const input = listInput.parse(rawInput);
      const rows = await db.select({
        id: assets.id,
        filename: assets.filename,
        displayName: assets.displayName,
        mimeType: assets.mimeType,
        sizeBytes: assets.sizeBytes,
        kind: assets.kind,
        source: assets.source,
        updatedAt: assets.updatedAt,
      }).from(assets)
        .where(and(eq(assets.userId, ctx.userId), eq(assets.status, "ready"), isNull(assets.deletedAt)))
        .orderBy(desc(assets.updatedAt))
        .limit(input.limit ?? 30);
      return success(ctx, toolCallId, startedAt, { count: rows.length, files: rows.map(serialize) });
    } catch (error) {
      return failure(ctx, toolCallId, startedAt, error);
    }
  },
};

export const filesSearchTool: AgentToolDefinition = {
  name: "files.search",
  description: "Search the user's GSW Files by filename or display name. Use this to locate an uploaded document, spreadsheet, image, presentation, video, or other asset.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Filename words or file name fragment." },
      limit: { type: "number", minimum: 1, maximum: 50 },
    },
    required: ["query"],
    additionalProperties: false,
  },
  requiredScopes: ["files.read"],
  risk: "read",
  async execute(ctx, rawInput, toolCallId) {
    const startedAt = new Date().toISOString();
    try {
      const input = searchInput.parse(rawInput);
      const like = `%${input.query}%`;
      const rows = await db.select({
        id: assets.id,
        filename: assets.filename,
        displayName: assets.displayName,
        mimeType: assets.mimeType,
        sizeBytes: assets.sizeBytes,
        kind: assets.kind,
        source: assets.source,
        updatedAt: assets.updatedAt,
      }).from(assets)
        .where(and(
          eq(assets.userId, ctx.userId),
          eq(assets.status, "ready"),
          isNull(assets.deletedAt),
          or(ilike(assets.filename, like), ilike(assets.displayName, like)),
        ))
        .orderBy(desc(assets.updatedAt))
        .limit(input.limit ?? 20);
      return success(ctx, toolCallId, startedAt, { count: rows.length, files: rows.map(serialize) });
    } catch (error) {
      return failure(ctx, toolCallId, startedAt, error);
    }
  },
};

const readableTextMime = (mimeType: string, filename: string) =>
  mimeType.startsWith("text/")
  || mimeType === "application/json"
  || mimeType === "application/xml"
  || mimeType === "application/javascript"
  || /\.(txt|md|csv|json|xml|html|css|js|ts|tsx|jsx|log)$/i.test(filename);

export const filesReadTool: AgentToolDefinition = {
  name: "files.read",
  description: "Read metadata for a GSW file and, for plain text/CSV/JSON/code files, return a bounded text preview. PDF, Office, image, audio, and video understanding will use the document-processing layer in the next phase.",
  inputSchema: {
    type: "object",
    properties: { assetId: { type: "string", description: "Asset ID returned by files.list/files.search or supplied with a chat attachment." } },
    required: ["assetId"],
    additionalProperties: false,
  },
  requiredScopes: ["files.read"],
  risk: "read",
  async execute(ctx, rawInput, toolCallId) {
    const startedAt = new Date().toISOString();
    try {
      const input = readInput.parse(rawInput);
      const [row] = await db.select().from(assets).where(and(
        eq(assets.id, input.assetId),
        eq(assets.userId, ctx.userId),
        eq(assets.status, "ready"),
        isNull(assets.deletedAt),
      )).limit(1);
      if (!row) throw new Error("file not found");

      let textPreview: string | undefined;
      if (readableTextMime(row.mimeType, row.filename) && Number(row.sizeBytes) <= 2 * 1024 * 1024) {
        const object = await getR2Object(row.r2Key);
        textPreview = object.content.toString("utf8").slice(0, 40_000);
      }

      return success(ctx, toolCallId, startedAt, {
        assetId: row.id,
        filename: row.displayName || row.filename,
        originalFilename: row.filename,
        mimeType: row.mimeType,
        sizeBytes: Number(row.sizeBytes),
        kind: row.kind,
        source: row.source,
        textPreview,
        processingNote: textPreview === undefined
          ? "This file is stored and attachable, but deep content extraction for this format is not enabled yet."
          : undefined,
      });
    } catch (error) {
      return failure(ctx, toolCallId, startedAt, error);
    }
  },
};

export const mailAttachFileTool: AgentToolDefinition = {
  name: "mail.attach_file",
  description: "Attach an existing GSW Files asset to an existing email draft. The draft must already exist. This changes the draft but does not send it.",
  inputSchema: {
    type: "object",
    properties: {
      draftId: { type: "string", description: "Existing draft ID returned by mail.create_draft or mail.update_draft." },
      assetId: { type: "string", description: "GSW Files asset ID returned by files.list/files.search or a chat attachment." },
      contentDisposition: { type: "string", enum: ["attachment", "inline"] },
      contentId: { type: "string" },
    },
    required: ["draftId", "assetId"],
    additionalProperties: false,
  },
  requiredScopes: ["mail.write", "files.read"],
  risk: "reversible_write",
  async execute(ctx, rawInput, toolCallId) {
    const startedAt = new Date().toISOString();
    try {
      const input = attachInput.parse(rawInput);
      const attachment = await attachExistingAssetToDraft({
        accountId: ctx.accountId,
        draftEngineId: input.draftId,
        userId: ctx.userId,
        assetId: input.assetId,
        contentDisposition: input.contentDisposition,
        contentId: input.contentId,
      });
      return success(ctx, toolCallId, startedAt, { draftId: input.draftId, attachment });
    } catch (error) {
      return failure(ctx, toolCallId, startedAt, error);
    }
  },
};

export const fileTools: AgentToolDefinition[] = [filesListTool, filesSearchTool, filesReadTool, mailAttachFileTool];
