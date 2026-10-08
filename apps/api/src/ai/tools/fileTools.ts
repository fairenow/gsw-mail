import { and, desc, eq, ilike, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { config } from "../../config.js";
import { db } from "../../db/client.js";
import { assets } from "../../db/schema.js";
import { getR2Object } from "../../files/r2.js";
import { analyzeStoredFile } from "../../files/intelligence.js";
import { detectFileType, isTextLikeFile } from "../../files/fileTypes.js";
import { generateArtifactFile, transformArtifactFile } from "../../files/artifacts.js";
import { generateImage } from "../../files/imageGeneration.js";
import { createAssetFromBuffer } from "../../files/service.js";
import { getOrCreateFileWorkspace } from "../../files/workspaces.js";
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
  content: z.string().max(120_000).optional(),
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
  assetId: z.string().uuid().optional(),
  assetIds: z.array(z.string().uuid()).min(1).max(20).optional(),
  contentDisposition: z.enum(["attachment", "inline"]).optional(),
  contentId: z.string().max(500).optional(),
}).refine((value) => Boolean(value.assetId || value.assetIds?.length), {
  message: "assetId or assetIds is required",
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

export const filesReadTool: AgentToolDefinition = {
  name: "files.read",
  description: "Read a GSW file. Text/code/calendar/email-text files return a bounded text preview; other files use the configured file-intelligence strategy when available. GSW stores and can attach arbitrary file types even when deep analysis is best-effort.",
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
      const detected = detectFileType(row.filename, row.mimeType);
      if (isTextLikeFile(row.filename, row.mimeType) && Number(row.sizeBytes) <= 2 * 1024 * 1024) {
        const object = await getR2Object(row.r2Key);
        textPreview = object.content.toString("utf8").slice(0, 40_000);
      } else if (
        ["pdf", "document", "spreadsheet", "presentation", "image", "video"].includes(detected.category)
        || config.ai.openaiApiKey
      ) {
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
        category: detected.category,
        analysisStrategy: detected.strategy,
        textPreview,
        deepAnalysis,
        analysisMode,
        analysisModel,
        processingNote: textPreview === undefined && deepAnalysis === undefined
          ? "This file type could not be deeply extracted with the currently available GSW file tools."
          : undefined,
      });
    } catch (error) {
      return failure(ctx, toolCallId, startedAt, error);
    }
  },
};



export const filesAnalyzeTool: AgentToolDefinition = {
  name: "files.analyze",
  description: "Deeply analyze a stored GSW file using the appropriate strategy for its type: direct text, document/PDF analysis, spreadsheet or archive sandbox inspection, image vision, audio transcription, combined video analysis, or best-effort binary inspection.",
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
  description: "Create a finished downloadable artifact in the user's My Files library. Create a genuine finished file. For PDF, create complete self-contained, print-ready HTML/CSS in the content field, with genuine document body copy (not the design brief). The PDF renderer runs locally in Chromium independently of the selected chat provider and does not require OpenAI credits. Keep styling directions in instruction. No external scripts, stylesheets or network assets.",
  inputSchema: {
    type: "object",
    properties: {
      filename: { type: "string", description: "Exact output filename including a supported extension such as report.pdf, plan.docx, budget.xlsx, or deck.pptx." },
      instruction: { type: "string", description: "Detailed layout, styling, calculations, tables, charts, or structure instructions." },
      content: { type: "string", description: "Complete final body copy for the artifact. For PDFs provide full self-contained HTML/CSS for a designed document, or source text/Markdown for a basic PDF. Do not pass the design brief as document content." },
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
      const localPdf = /\.pdf$/i.test(input.filename);
      // Use a standalone code-interpreter session for designed PDFs. The
      // generator handles local fallback only when complete source copy exists.
      const workspace = !localPdf && ctx.conversationId
        ? await getOrCreateFileWorkspace(ctx.userId, ctx.conversationId)
        : null;
      const generated = await generateArtifactFile({
        filename: input.filename,
        instruction: input.instruction,
        ...(input.content !== undefined ? { content: input.content } : {}),
        ...(workspace ? { containerId: workspace.externalContainerId } : {}),
      });
      if (!generated.bytes) throw new Error("PDF artifact did not return a file");
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
  description: "Open one or more existing GSW Files in a sandboxed computational workspace, modify/analyze their real contents, and save a new output file. Use this for revising existing PDFs, restyling documents to match brand templates, or transforming DOCX/XLSX/PPTX and other sources. When a user mentions a saved PDF and a branding template, search for BOTH files first, then pass both source asset IDs so the designer has the actual original content and brand reference. Never merely print the styling instructions as the resulting document.",
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

      const workspace = ctx.conversationId ? await getOrCreateFileWorkspace(ctx.userId, ctx.conversationId) : null;
      const generated = await transformArtifactFile({
        filename: input.filename,
        instruction: input.instruction,
        sources: sourceRows,
        ...(workspace ? { containerId: workspace.externalContainerId } : {}),
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
  description: "Attach one or more existing GSW Files assets to an existing email draft. Use files.search or files.list first when the user refers to a saved file by name. If there is no draft yet, create it with mail.create_draft, then attach the file(s). This changes the draft but never sends it.",
  inputSchema: {
    type: "object",
    properties: {
      draftId: { type: "string", description: "Existing draft ID returned by mail.create_draft or mail.update_draft." },
      assetId: { type: "string", description: "Single GSW Files asset ID returned by files.list/files.search or a chat attachment." },
      assetIds: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 20, description: "Multiple GSW Files asset IDs to attach in one action." },
      contentDisposition: { type: "string", enum: ["attachment", "inline"] },
      contentId: { type: "string" },
    },
    required: ["draftId"],
    additionalProperties: false,
  },
  requiredScopes: ["mail.write", "files.read"],
  risk: "reversible_write",
  async execute(ctx, rawInput, toolCallId) {
    const startedAt = new Date().toISOString();
    try {
      const input = attachInput.parse(rawInput);
      const assetIds = [...new Set([...(input.assetId ? [input.assetId] : []), ...(input.assetIds ?? [])])];
      const attachments = [];
      for (const assetId of assetIds) {
        attachments.push(await attachExistingAssetToDraft({
          accountId: ctx.accountId,
          draftEngineId: input.draftId,
          userId: ctx.userId,
          assetId,
          contentDisposition: input.contentDisposition,
          contentId: assetIds.length === 1 ? input.contentId : undefined,
        }));
      }
      return success(ctx, toolCallId, startedAt, { draftId: input.draftId, attachments });
    } catch (error) {
      return failure(ctx, toolCallId, startedAt, error);
    }
  },
};

export const fileTools: AgentToolDefinition[] = [filesListTool, filesSearchTool, filesReadTool, filesAnalyzeTool, filesCreateTextTool, filesCreateArtifactTool, filesTransformTool, filesGenerateImageTool, mailAttachFileTool];
