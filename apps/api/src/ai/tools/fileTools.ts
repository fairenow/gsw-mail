import { and, desc, eq, ilike, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { config } from "../../config.js";
import { db } from "../../db/client.js";
import { assets } from "../../db/schema.js";
import { getR2Object } from "../../files/r2.js";
import { analyzeStoredFile } from "../../files/intelligence.js";
import { generateArtifactFile, transformArtifactFile } from "../../files/artifacts.js";
import { generateImage } from "../../files/imageGeneration.js";
import { createAssetFromBuffer } from "../../files/service.js";
import { getOrCreateFileWorkspace, touchFileWorkspace } from "../../files/workspaces.js";
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
const analyzeInput = z.object({
  assetId: z.string().uuid(),
  instruction: z.string().trim().min(1).max(4_000).optional(),
});
const createTextFileInput = z.object({
  filename: z.string().trim().min(1).max(255),
  content: z.string().max(500_000),
  format: z.enum(["txt", "md", "csv", "json", "html"]).optional(),
});
const createArtifactInput = z.object({
  filename: z.string().trim().min(1).max(255).refine(
    (value) => /\.(pdf|docx|xlsx|pptx|csv|txt|md|html|json|png|jpe?g)$/i.test(value),
    "unsupported artifact file extension",
  ),
  instruction: z.string().trim().min(1).max(20_000),
});
const transformArtifactInput = z.object({
  sourceAssetIds: z.array(z.string().uuid()).min(1).max(5),
  filename: z.string().trim().min(1).max(255).refine(
    (value) => /\.(pdf|docx|xlsx|pptx|csv|txt|md|html|json|png|jpe?g)$/i.test(value),
    "unsupported output file extension",
  ),
  instruction: z.string().trim().min(1).max(20_000),
});
const generateImageInput = z.object({
  filename: z.string().trim().min(1).max(255).optional(),
  prompt: z.string().trim().min(1).max(32_000),
  size: z.enum(["1024x1024", "1536x1024", "1024x1536", "auto"]).optional(),
  quality: z.enum(["low", "medium", "high", "auto"]).optional(),
  background: z.enum(["transparent", "opaque", "auto"]).optional(),
  format: z.enum(["png", "jpeg", "webp"]).optional(),
});
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
  description: "Read metadata for a GSW file and, for plain text/CSV/JSON/code files, return a bounded text preview. Use files.analyze for PDFs, Office files, images, audio, or video-audio transcription.",
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
      let deepAnalysis: string | undefined;
      let analysisMode: string | undefined;
      let analysisModel: string | undefined;
      if (readableTextMime(row.mimeType, row.filename) && Number(row.sizeBytes) <= 2 * 1024 * 1024) {
        const object = await getR2Object(row.r2Key);
        textPreview = object.content.toString("utf8").slice(0, 40_000);
      } else if (config.ai.openaiApiKey) {
        const object = await getR2Object(row.r2Key);
        const result = await analyzeStoredFile({
          filename: row.filename,
          mimeType: row.mimeType,
          bytes: object.content,
          instruction: "Read and understand this file. Return a concise but useful analysis of its actual contents, including key facts, structure, important numbers, dates, obligations, risks, and action items when present.",
        });
        deepAnalysis = result.text.slice(0, 80_000);
        analysisMode = result.mode;
        analysisModel = result.model;
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
        deepAnalysis,
        analysisMode,
        analysisModel,
        processingNote: textPreview === undefined && deepAnalysis === undefined
          ? "Deep content extraction is unavailable because the enhanced file intelligence service is not configured."
          : undefined,
      });
    } catch (error) {
      return failure(ctx, toolCallId, startedAt, error);
    }
  },
};



export const filesAnalyzeTool: AgentToolDefinition = {
  name: "files.analyze",
  description: "Deeply analyze a stored GSW file. Supports PDFs, Word documents, PowerPoint presentations, spreadsheets, images, and audio transcription. Video files currently provide audio-track transcription rather than visual frame analysis.",
  inputSchema: {
    type: "object",
    properties: {
      assetId: { type: "string", description: "Asset ID returned by files.list/files.search or supplied with a chat attachment." },
      instruction: { type: "string", description: "What to extract, understand, summarize, compare, or answer from the file." },
    },
    required: ["assetId"],
    additionalProperties: false,
  },
  requiredScopes: ["files.read"],
  risk: "read",
  async execute(ctx, rawInput, toolCallId) {
    const startedAt = new Date().toISOString();
    try {
      const input = analyzeInput.parse(rawInput);
      const [row] = await db.select().from(assets).where(and(
        eq(assets.id, input.assetId),
        eq(assets.userId, ctx.userId),
        eq(assets.status, "ready"),
        isNull(assets.deletedAt),
      )).limit(1);
      if (!row) throw new Error("file not found");

      const object = await getR2Object(row.r2Key);
      const result = await analyzeStoredFile({
        filename: row.filename,
        mimeType: row.mimeType,
        bytes: object.content,
        instruction: input.instruction ?? "Analyze this file. Give a concise summary, identify the most important information, and answer any obvious questions the user may have about it.",
      });
      return success(ctx, toolCallId, startedAt, {
        assetId: row.id,
        filename: row.displayName || row.filename,
        mimeType: row.mimeType,
        mode: result.mode,
        model: result.model,
        analysis: result.text.slice(0, 80_000),
        ...("note" in result && result.note ? { note: result.note } : {}),
      });
    } catch (error) {
      return failure(ctx, toolCallId, startedAt, error);
    }
  },
};

const mimeForFormat = (format: string) => ({
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  json: "application/json",
  html: "text/html",
}[format] ?? "text/plain");

export const filesCreateTextTool: AgentToolDefinition = {
  name: "files.create_text",
  description: "Create a new text-based file in the user's My Files library. Supports TXT, Markdown, CSV, JSON, and HTML. Use CSV for simple spreadsheet-style outputs. This does not create native DOCX/XLSX/PPTX yet.",
  inputSchema: {
    type: "object",
    properties: {
      filename: { type: "string" },
      content: { type: "string" },
      format: { type: "string", enum: ["txt", "md", "csv", "json", "html"] },
    },
    required: ["filename", "content"],
    additionalProperties: false,
  },
  requiredScopes: ["files.write"],
  risk: "reversible_write",
  async execute(ctx, rawInput, toolCallId) {
    const startedAt = new Date().toISOString();
    try {
      const input = createTextFileInput.parse(rawInput);
      const format = input.format ?? (input.filename.split(".").pop()?.toLowerCase() || "txt");
      const filename = input.filename.includes(".") ? input.filename : `${input.filename}.${format}`;
      const asset = await createAssetFromBuffer({
        userId: ctx.userId,
        filename,
        mimeType: mimeForFormat(format),
        content: Buffer.from(input.content, "utf8"),
        source: "chat_generated",
        kind: format === "csv" ? "spreadsheet" : "document",
        addToFiles: true,
      });
      return success(ctx, toolCallId, startedAt, {
        assetId: asset.id,
        filename: asset.displayName || asset.filename,
        mimeType: asset.mimeType,
        sizeBytes: Number(asset.sizeBytes),
      });
    } catch (error) {
      return failure(ctx, toolCallId, startedAt, error);
    }
  },
};



export const filesCreateArtifactTool: AgentToolDefinition = {
  name: "files.create_artifact",
  description: "Create a finished downloadable artifact in the user's My Files library using a sandboxed code interpreter. Supports PDF, DOCX, XLSX, PPTX, CSV, TXT, Markdown, HTML, JSON, PNG, and JPEG outputs. Use this for native documents, spreadsheets, presentations, PDFs, charts, and other generated files.",
  inputSchema: {
    type: "object",
    properties: {
      filename: { type: "string", description: "Exact output filename including a supported extension such as report.pdf, plan.docx, budget.xlsx, or deck.pptx." },
      instruction: { type: "string", description: "Detailed instructions for the artifact's content, layout, calculations, tables, charts, or structure." },
    },
    required: ["filename", "instruction"],
    additionalProperties: false,
  },
  requiredScopes: ["files.write"],
  risk: "reversible_write",
  async execute(ctx, rawInput, toolCallId) {
    const startedAt = new Date().toISOString();
    try {
      const input = createArtifactInput.parse(rawInput);
      const generated = await generateArtifactFile(input);
      const asset = await createAssetFromBuffer({
        userId: ctx.userId,
        filename: generated.filename,
        mimeType: generated.mimeType,
        content: generated.bytes,
        source: "chat_generated",
        kind: generated.mimeType.includes("spreadsheet") || generated.filename.toLowerCase().endsWith(".xlsx")
          ? "spreadsheet"
          : generated.mimeType.includes("presentation") || generated.filename.toLowerCase().endsWith(".pptx")
            ? "presentation"
            : generated.mimeType.startsWith("image/")
              ? "image"
              : generated.mimeType === "application/pdf"
                ? "pdf"
                : "document",
        addToFiles: true,
      });
      return success(ctx, toolCallId, startedAt, {
        assetId: asset.id,
        filename: asset.displayName || asset.filename,
        mimeType: asset.mimeType,
        sizeBytes: Number(asset.sizeBytes),
        model: generated.model,
      });
    } catch (error) {
      return failure(ctx, toolCallId, startedAt, error);
    }
  },
};





export const filesTransformTool: AgentToolDefinition = {
  name: "files.transform",
  description: "Open one or more existing GSW Files in a sandboxed computational workspace, modify/analyze their real contents, and save a new output file. Use this for requests such as cleaning an XLSX, adding formulas/charts, converting data into a report, revising a DOCX, or turning source files into a new PDF/PPTX/XLSX/DOCX.",
  inputSchema: {
    type: "object",
    properties: {
      sourceAssetIds: {
        type: "array",
        items: { type: "string" },
        minItems: 1,
        maxItems: 5,
        description: "Asset IDs of the source files to transform.",
      },
      filename: { type: "string", description: "Exact filename for the new output, including extension." },
      instruction: { type: "string", description: "Detailed transformation instructions." },
    },
    required: ["sourceAssetIds", "filename", "instruction"],
    additionalProperties: false,
  },
  requiredScopes: ["files.read", "files.write"],
  risk: "reversible_write",
  async execute(ctx, rawInput, toolCallId) {
    const startedAt = new Date().toISOString();
    try {
      const input = transformArtifactInput.parse(rawInput);
      const sourceRows = [];
      for (const assetId of input.sourceAssetIds) {
        const [row] = await db.select().from(assets).where(and(
          eq(assets.id, assetId),
          eq(assets.userId, ctx.userId),
          eq(assets.status, "ready"),
          isNull(assets.deletedAt),
        )).limit(1);
        if (!row) throw new Error(`source file not found: ${assetId}`);
        const object = await getR2Object(row.r2Key);
        sourceRows.push({
          filename: row.displayName || row.filename,
          mimeType: row.mimeType,
          bytes: object.content,
        });
      }

      const generated = await transformArtifactFile({
        filename: input.filename,
        instruction: input.instruction,
        sources: sourceRows,
      });
      const asset = await createAssetFromBuffer({
        userId: ctx.userId,
        filename: generated.filename,
        mimeType: generated.mimeType,
        content: generated.bytes,
        source: "chat_transformed",
        kind: generated.mimeType.includes("spreadsheet") || generated.filename.toLowerCase().endsWith(".xlsx")
          ? "spreadsheet"
          : generated.mimeType.includes("presentation") || generated.filename.toLowerCase().endsWith(".pptx")
            ? "presentation"
            : generated.mimeType.startsWith("image/")
              ? "image"
              : generated.mimeType === "application/pdf"
                ? "pdf"
                : "document",
        addToFiles: true,
      });
      return success(ctx, toolCallId, startedAt, {
        assetId: asset.id,
        filename: asset.displayName || asset.filename,
        mimeType: asset.mimeType,
        sizeBytes: Number(asset.sizeBytes),
        sourceAssetIds: input.sourceAssetIds,
        model: generated.model,
      });
    } catch (error) {
      return failure(ctx, toolCallId, startedAt, error);
    }
  },
};

export const filesGenerateImageTool: AgentToolDefinition = {
  name: "files.generate_image",
  description: "Generate a new image from a text prompt and save it into the user's private My Files library. Use this for illustrations, graphics, concepts, banners, thumbnails, and other generated images.",
  inputSchema: {
    type: "object",
    properties: {
      filename: { type: "string", description: "Optional filename. The correct extension is added if missing." },
      prompt: { type: "string", description: "Detailed image-generation prompt." },
      size: { type: "string", enum: ["1024x1024", "1536x1024", "1024x1536", "auto"] },
      quality: { type: "string", enum: ["low", "medium", "high", "auto"] },
      background: { type: "string", enum: ["transparent", "opaque", "auto"] },
      format: { type: "string", enum: ["png", "jpeg", "webp"] },
    },
    required: ["prompt"],
    additionalProperties: false,
  },
  requiredScopes: ["files.write", "images.generate"],
  risk: "reversible_write",
  async execute(ctx, rawInput, toolCallId) {
    const startedAt = new Date().toISOString();
    try {
      const input = generateImageInput.parse(rawInput);
      const requestedFormat = input.format
        ?? (input.filename?.toLowerCase().endsWith(".jpg") || input.filename?.toLowerCase().endsWith(".jpeg")
          ? "jpeg"
          : input.filename?.toLowerCase().endsWith(".webp")
            ? "webp"
            : "png");
      const generated = await generateImage({ ...input, format: requestedFormat });
      const base = (input.filename?.trim() || "generated-image").replace(/\.(png|jpe?g|webp)$/i, "");
      const filename = `${base}.${generated.extension}`;
      const asset = await createAssetFromBuffer({
        userId: ctx.userId,
        filename,
        mimeType: generated.mimeType,
        content: generated.bytes,
        source: "chat_generated",
        kind: "image",
        addToFiles: true,
      });
      return success(ctx, toolCallId, startedAt, {
        assetId: asset.id,
        filename: asset.displayName || asset.filename,
        mimeType: asset.mimeType,
        sizeBytes: Number(asset.sizeBytes),
        model: generated.model,
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

export const fileTools: AgentToolDefinition[] = [filesListTool, filesSearchTool, filesReadTool, filesAnalyzeTool, filesCreateTextTool, filesCreateArtifactTool, filesTransformTool, filesGenerateImageTool, mailAttachFileTool];
