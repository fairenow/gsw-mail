import { eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import { contactTags, contacts } from "../../db/schema.js";
import type { AgentExecutionContext, AgentToolDefinition, AgentToolResult } from "./types.js";

export const contactTagTool: AgentToolDefinition = {
  name: "contacts.tags",
  description: "List contact tags available to the user with counts. Use this before campaign creation when the requested audience label is uncertain.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  requiredScopes: ["contacts.read"],
  risk: "read",
  async execute(ctx, _rawInput, toolCallId) {
    const startedAt = new Date().toISOString();
    try {
      const rows = await db.select({
        contactId: contactTags.contactId,
        tag: contactTags.tag,
        normalizedTag: contactTags.normalizedTag,
      }).from(contactTags).innerJoin(contacts, eq(contactTags.contactId, contacts.id)).where(eq(contacts.ownerUserId, ctx.userId));
      const counts = new Map<string, { tag: string; count: number }>();
      for (const row of rows) {
        const current = counts.get(row.normalizedTag);
        counts.set(row.normalizedTag, { tag: current?.tag ?? row.tag, count: (current?.count ?? 0) + 1 });
      }
      return {
        ok: true,
        toolCallId,
        data: { tags: [...counts.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)) },
        audit: { userId: ctx.userId, accountId: ctx.accountId, startedAt, completedAt: new Date().toISOString() },
      };
    } catch (error) {
      return {
        ok: false,
        toolCallId,
        error: { code: "tool_failed", message: error instanceof Error ? error.message : String(error), retryable: false },
        audit: { userId: ctx.userId, accountId: ctx.accountId, startedAt, completedAt: new Date().toISOString() },
      };
    }
  },
};

export const contactTools: AgentToolDefinition[] = [contactTagTool];
