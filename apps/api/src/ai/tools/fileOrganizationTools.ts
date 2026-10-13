import { createHash } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client.js";
import { assets, fileNodes } from "../../db/schema.js";
import { createFolder, moveFileNode } from "../../files/service.js";
import type { AgentToolDefinition, AgentExecutionContext, AgentToolResult } from "./types.js";

const params = z.object({
  dateBasis: z.enum(["created", "uploaded"]).default("created"),
  limit: z.number().int().min(1).max(100).default(50),
});
type Params = z.infer<typeof params>;
type NodeRow = { id: string; parentId: string | null; name: string; nodeType: string; assetId: string | null; createdAt: Date; mimeType: string | null; assetCreatedAt: Date | null };
export type Action = { nodeId: string; name: string; from: string | null; date: string; type: string };

function typeFolder(name: string, mime: string | null): string {
  const ext = name.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
  if (ext === "csv" || ext === "tsv") return "CSV";
  if (ext === "xlsx" || ext === "xls" || ext === "ods") return "Spreadsheets";
  if (ext === "pdf") return "PDF";
  if (["png","jpg","jpeg","gif","webp","heic","svg","avif"].includes(ext || "") || mime?.startsWith("image/")) return "Images";
  if (["doc","docx","rtf","txt","md"].includes(ext || "")) return "Documents";
  if (["ppt","pptx"].includes(ext || "")) return "Presentations";
  if (["mp4","mov","avi","webm"].includes(ext || "") || mime?.startsWith("video/")) return "Videos";
  if (["mp3","wav","m4a","ogg"].includes(ext || "") || mime?.startsWith("audio/")) return "Audio";
  if (["zip","rar","7z","tar","gz"].includes(ext || "")) return "Archives";
  return "Other";
}
const dayUTC = (date: Date) => date.toISOString().slice(0, 10);
export async function inventory(userId: string, input: Params) {
  const rows = await db.select({
    id: fileNodes.id, parentId: fileNodes.parentId, name: fileNodes.name,
    nodeType: fileNodes.nodeType, assetId: fileNodes.assetId, createdAt: fileNodes.createdAt,
    mimeType: assets.mimeType, assetCreatedAt: assets.createdAt,
  }).from(fileNodes).leftJoin(assets, eq(fileNodes.assetId, assets.id))
    .where(and(eq(fileNodes.userId, userId), isNull(fileNodes.trashedAt)));
  const folders = new Map(rows.filter(r => r.nodeType === "folder").map(r => [r.id, r]));
  const target = new Map<string, { date: string; type: string; count: number }>();
  const actions: Action[] = [];
  for (const row of rows) {
    if (row.nodeType !== "file" || !row.assetId) continue;
    const date = dayUTC(input.dateBasis === "uploaded" ? (row.assetCreatedAt ?? row.createdAt) : row.createdAt);
    const type = typeFolder(row.name, row.mimeType);
    const parent = row.parentId ? folders.get(row.parentId) : null;
    const grandparent = parent?.parentId ? folders.get(parent.parentId) : null;
    // Exclude files already in the desired day/type structure, including reruns.
    if (parent?.name === type && grandparent?.name === date && grandparent.parentId === null) continue;
    actions.push({ nodeId: row.id, name: row.name, from: row.parentId, date, type });
    const key = `${date}/${type}`;
    const existing = target.get(key);
    target.set(key, { date, type, count: (existing?.count ?? 0) + 1 });
  }
  actions.sort((a, b) => a.date.localeCompare(b.date) || a.type.localeCompare(b.type) || a.nodeId.localeCompare(b.nodeId));
  const fingerprint = createHash("sha256").update(JSON.stringify({
    userId, dateBasis: input.dateBasis, actions,
  })).digest("hex");
  return { actions, target: [...target.values()].sort((a,b) => b.date.localeCompare(a.date) || a.type.localeCompare(b.type)), fingerprint, inventoryCount: rows.length };
}
const respond = (ctx: AgentExecutionContext, toolCallId: string, startedAt: string, data: unknown): AgentToolResult => ({
  ok: true, toolCallId, data, audit: { userId: ctx.userId, accountId: ctx.accountId, startedAt, completedAt: new Date().toISOString() },
});
const errorResult = (ctx: AgentExecutionContext, toolCallId: string, startedAt: string, error: unknown): AgentToolResult => ({
  ok: false, toolCallId, error: { code: "organize_failed", message: error instanceof Error ? error.message : "Organization failed", retryable: false },
  audit: { userId: ctx.userId, accountId: ctx.accountId, startedAt, completedAt: new Date().toISOString() },
});
const inputFields = {
  dateBasis: { type: "string", enum: ["created", "uploaded"], description: "created = GSW file entry creation date; uploaded = original asset upload date. Dates are grouped by UTC." },
  limit: { type: "integer", minimum: 1, maximum: 100, description: "Maximum number of files moved in this one approved batch; default 50." },
};
const tool = (name: string, description: string, mode: "read" | "reversible_write", extra: Record<string, unknown>,
  required: string[], run: (ctx: AgentExecutionContext, input: any) => Promise<unknown>): AgentToolDefinition => ({
    name, description, risk: mode, requiredScopes: [mode === "read" ? "files.read" : "files.write"],
    inputSchema: { type: "object", properties: { ...inputFields, ...extra }, required, additionalProperties: false },
    async execute(ctx, raw, toolCallId) {
      const startedAt = new Date().toISOString();
      try {
        const input = params.extend({ planHash: z.string().regex(/^[0-9a-f]{64}$/).optional() }).parse(raw);
        return respond(ctx, toolCallId, startedAt, await run(ctx, input));
      } catch (err) { return errorResult(ctx, toolCallId, startedAt, err); }
    },
  });

export const fileOrganizationTools: AgentToolDefinition[] = [
  tool("files.organize_preview",
    "Preview existing GSW Files grouped into UTC day folders and file-type subfolders. Does not modify anything. Show preview and request user approval before files.organize_apply.",
    "read", {}, [], async (ctx, input: Params) => {
      const plan = await inventory(ctx.userId, input);
      return {
        planHash: plan.fingerprint, dateBasis: input.dateBasis,
        filesToMove: plan.actions.length, totalNodes: plan.inventoryCount,
        targetFolders: plan.target,
        sample: plan.actions.slice(0, 20).map(({ nodeId, name, date, type }) => ({ nodeId, name, destination: `${date}/${type}` })),
        instructions: "Ask for explicit approval; then call files.organize_apply with exactly this planHash. Do not claim files moved during preview.",
      };
    }),
  tool("files.organize_apply",
    "After explicit user approval, safely move a bounded batch of existing files into UTC YYYY-MM-DD/type folders. Preserves files and contents; reruns are idempotent. Call preview again after a batch to continue.",
    "reversible_write", { planHash: { type: "string", description: "Exact SHA256 planHash returned by files.organize_preview; rejects stale plans." } },
    ["planHash"], async (ctx, input: Params & { planHash?: string }) => {
      const before = await inventory(ctx.userId, input);
      if (!input.planHash || input.planHash !== before.fingerprint)
        throw new Error("File inventory has changed. Run files.organize_preview again before approval.");
      const batch = before.actions.slice(0, input.limit);
      const moved: Array<{ nodeId: string; name: string; destination: string }> = [];
      const failed: Array<{ nodeId: string; reason: string }> = [];
      const folderCache = new Map<string, string>();
      async function folder(name: string, parentId: string | null) {
        const key = `${parentId || "root"}/${name}`;
        if (folderCache.has(key)) return folderCache.get(key)!;
        // Recheck inside each step; avoid duplicate folders after retry.
        const existing = await db.select({ id: fileNodes.id }).from(fileNodes).where(and(
          eq(fileNodes.userId, ctx.userId), eq(fileNodes.nodeType, "folder"), eq(fileNodes.name, name),
          parentId ? eq(fileNodes.parentId, parentId) : isNull(fileNodes.parentId), isNull(fileNodes.trashedAt),
        )).limit(1);
        const id = existing[0]?.id ?? (await createFolder(ctx.userId, name, parentId)).id;
        folderCache.set(key, id);
        return id;
      }
      for (const action of batch) {
        try {
          const day = await folder(action.date, null);
          const type = await folder(action.type, day);
          await moveFileNode(ctx.userId, action.nodeId, type);
          moved.push({ nodeId: action.nodeId, name: action.name, destination: `${action.date}/${action.type}` });
        } catch (err) { failed.push({ nodeId: action.nodeId, reason: err instanceof Error ? err.message : "Could not move file" }); }
      }
      return { movedCount: moved.length, failedCount: failed.length, remainingEstimate: before.actions.length - moved.length,
        moved: moved.slice(0, 25), failed, completed: before.actions.length === moved.length,
        nextStep: before.actions.length > moved.length ? "Review failures and run files.organize_preview again before another approved batch." : "All planned files were moved." };
    }),
];
