import { and, eq, ilike, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client.js";
import { fileNodes } from "../../db/schema.js";
import { createFolder, listFiles, moveFileNode, renameFileNode, trashFileNode, restoreFileNode, permanentlyDeleteFileNode } from "../../files/service.js";
import type { AgentToolDefinition, AgentExecutionContext, AgentToolResult } from "./types.js";

const uuid = z.string().uuid();
const folderId = uuid.nullable().optional();
const name = z.string().trim().min(1).max(255);
const result = (ctx: AgentExecutionContext, toolCallId: string, startedAt: string, data: unknown): AgentToolResult => ({
  ok: true, toolCallId, data, audit: { userId: ctx.userId, accountId: ctx.accountId, startedAt, completedAt: new Date().toISOString() },
});
const fail = (ctx: AgentExecutionContext, toolCallId: string, startedAt: string, error: unknown): AgentToolResult => ({
  ok: false, toolCallId, error: { code: "tool_failed", message: error instanceof Error ? error.message : String(error), retryable: false },
  audit: { userId: ctx.userId, accountId: ctx.accountId, startedAt, completedAt: new Date().toISOString() },
});
function tool(name: string, description: string, properties: Record<string, unknown>, required: string[], risk: "read" | "reversible_write" | "external", schema: z.ZodTypeAny, run: (ctx: AgentExecutionContext, input: any) => Promise<unknown>): AgentToolDefinition {
  return { name, description, inputSchema: { type: "object", properties, required, additionalProperties: false }, requiredScopes: [risk === "read" ? "files.read" : "files.write"], risk,
    async execute(ctx, rawInput, toolCallId) {
      const startedAt = new Date().toISOString();
      try { const input = schema.parse(rawInput); return result(ctx, toolCallId, startedAt, await run(ctx, input)); }
      catch (error) { return fail(ctx, toolCallId, startedAt, error); }
    },
  };
}
const idProp = { type: "string", description: "File or folder node UUID from files.list_folder or files.search_nodes." };
const parentProp = { type: ["string", "null"], description: "Destination parent folder UUID, or null for root." };
const nameProp = { type: "string", description: "File or folder name." };
const folderProp = { type: ["string", "null"], description: "Folder UUID, or null for root." };
export const fileManagementTools: AgentToolDefinition[] = [
  tool("files.list_folder", "List files and subfolders in a GSW Files folder; omit parentId for root.", { parentId: folderProp }, [], "read", z.object({ parentId: folderId }), async (ctx, input) => {
    const files = await listFiles(ctx.userId, input.parentId ?? null);
    return { count: files.length, files, parentId: input.parentId ?? null };
  }),
  tool("files.search_nodes", "Search GSW Files folder names and filenames across all folders, returning node IDs and parent folder IDs.", { query: { type: "string" }, limit: { type: "number", minimum: 1, maximum: 100 } }, ["query"], "read",
    z.object({ query: name, limit: z.number().int().min(1).max(100).optional() }), async (ctx, input) => {
      const nodes = await db.select({ id: fileNodes.id, parentId: fileNodes.parentId, name: fileNodes.name, nodeType: fileNodes.nodeType, assetId: fileNodes.assetId })
        .from(fileNodes).where(and(eq(fileNodes.userId, ctx.userId), isNull(fileNodes.trashedAt), ilike(fileNodes.name, `%${input.query}%`))).limit(input.limit ?? 50);
      return { count: nodes.length, nodes };
    }),
  tool("files.create_folder", "Create a real GSW Files folder or subfolder, returning its ID. Use parentId to nest it.", { name: nameProp, parentId: folderProp }, ["name"], "reversible_write",
    z.object({ name, parentId: folderId }), async (ctx, input) => ({ folder: await createFolder(ctx.userId, input.name, input.parentId ?? null) })),
  tool("files.rename_node", "Rename a file or folder in GSW Files.", { nodeId: idProp, name: nameProp }, ["nodeId", "name"], "reversible_write",
    z.object({ nodeId: uuid, name }), async (ctx, input) => ({ node: await renameFileNode(ctx.userId, input.nodeId, input.name) })),
  tool("files.move_node", "Move a file or whole folder into another GSW Files folder; cannot move folders into their descendants.", { nodeId: idProp, parentId: parentProp }, ["nodeId", "parentId"], "reversible_write",
    z.object({ nodeId: uuid, parentId: uuid.nullable() }), async (ctx, input) => ({ node: await moveFileNode(ctx.userId, input.nodeId, input.parentId) })),
  tool("files.trash_node", "Move a file or folder to trash. This is destructive and requires user approval.", { nodeId: idProp }, ["nodeId"], "external",
    z.object({ nodeId: uuid }), async (ctx, input) => ({ node: await trashFileNode(ctx.userId, input.nodeId) })),
  tool("files.restore_node", "Restore a previously trashed file or folder.", { nodeId: idProp }, ["nodeId"], "reversible_write",
    z.object({ nodeId: uuid }), async (ctx, input) => ({ node: await restoreFileNode(ctx.userId, input.nodeId) })),
  tool("files.delete_node", "Permanently delete a GSW Files node. Requires user approval. Folders must be empty.", { nodeId: idProp }, ["nodeId"], "external",
    z.object({ nodeId: uuid }), async (ctx, input) => ({ deleted: await permanentlyDeleteFileNode(ctx.userId, input.nodeId) })),
];
