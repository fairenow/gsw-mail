import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { listContacts } from "../../lib/contacts.js";
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


const audit = (ctx: AgentExecutionContext, startedAt: string) => ({ userId: ctx.userId, accountId: ctx.accountId, startedAt, completedAt: new Date().toISOString() });
const errorResult = (ctx: AgentExecutionContext, toolCallId: string, startedAt: string) => ({
  ok: false, toolCallId, error: { code: "tool_failed", message: "The contact operation could not be completed.", retryable: false }, audit: audit(ctx, startedAt),
});

export const contactSearchTool: AgentToolDefinition = {
  name: "contacts.search",
  description: "Search the authenticated user's existing contacts by name, organization, or contact details. Returns a bounded preview; do not invent contacts.",
  inputSchema: { type: "object", properties: { query: { type: "string" }, limit: { type: "number", minimum: 1, maximum: 50 } }, required: ["query"], additionalProperties: false },
  requiredScopes: ["contacts.read"],
  risk: "read",
  async execute(ctx, rawInput, toolCallId) {
    const startedAt = new Date().toISOString();
    try {
      const { query, limit } = z.object({ query: z.string().trim().min(1).max(200), limit: z.number().int().min(1).max(50).default(20) }).parse(rawInput);
      const result = await listContacts(ctx.userId, query, limit);
      return { ok: true, toolCallId, data: result, audit: audit(ctx, startedAt) };
    } catch { return errorResult(ctx, toolCallId, startedAt); }
  },
};

export const contactAudiencePreviewTool: AgentToolDefinition = {
  name: "contacts.audience.preview",
  description: "Preview the user's contacts matching ALL supplied tags, including a count and bounded contact sample. Read-only; use before creating or launching a campaign.",
  inputSchema: { type: "object", properties: { tags: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 20 }, limit: { type: "number", minimum: 1, maximum: 50 } }, required: ["tags"], additionalProperties: false },
  requiredScopes: ["contacts.read"],
  risk: "read",
  async execute(ctx, rawInput, toolCallId) {
    const startedAt = new Date().toISOString();
    try {
      const { tags, limit } = z.object({ tags: z.array(z.string().trim().min(1).max(100)).min(1).max(20), limit: z.number().int().min(1).max(50).default(25) }).parse(rawInput);
      const normalized = [...new Set(tags.map(t => t.toLocaleLowerCase()))];
      const rows = await db.select({ id: contacts.id, displayName: contacts.displayName, tag: contactTags.normalizedTag })
        .from(contactTags).innerJoin(contacts, eq(contactTags.contactId, contacts.id))
        .where(and(eq(contacts.ownerUserId, ctx.userId), inArray(contactTags.normalizedTag, normalized)));
      const matches = new Map<string, { displayName: string | null; tags: Set<string> }>();
      for (const row of rows) {
        const item = matches.get(row.id) ?? { displayName: row.displayName, tags: new Set<string>() };
        item.tags.add(row.tag);
        matches.set(row.id, item);
      }
      const candidates = [...matches].filter(([, item]) => normalized.every(tag => item.tags.has(tag)));
      return { ok: true, toolCallId, data: { tags: normalized, recipientCount: candidates.length, contacts: candidates.slice(0, limit).map(([id,item])=>({ id, displayName: item.displayName })), truncated: candidates.length > limit, sendsEmail: false }, audit: audit(ctx, startedAt) };
    } catch { return errorResult(ctx, toolCallId, startedAt); }
  },
};

export const contactTagAssignTool: AgentToolDefinition = {
  name: "contacts.tags.assign",
  description: "Create a tag by assigning it to explicitly selected, owned contact IDs. Existing matching assignments are skipped. This never sends email.",
  inputSchema: { type: "object", properties: { tag: { type: "string" }, contactIds: { type: "array", items: { type: "string", format: "uuid" }, minItems: 1, maxItems: 50 } }, required: ["tag", "contactIds"], additionalProperties: false },
  requiredScopes: ["contacts.write"],
  risk: "reversible_write",
  async execute(ctx, rawInput, toolCallId) {
    const startedAt = new Date().toISOString();
    try {
      const { tag, contactIds } = z.object({ tag: z.string().trim().min(1).max(100), contactIds: z.array(z.string().uuid()).min(1).max(50) }).parse(rawInput);
      const ids = [...new Set(contactIds)];
      const owned = await db.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.ownerUserId, ctx.userId), inArray(contacts.id, ids)));
      if (owned.length !== ids.length) return { ok: false, toolCallId, error: { code: "not_authorized", message: "Some selected contacts are unavailable.", retryable: false }, audit: audit(ctx, startedAt) };
      const normalizedTag = tag.toLocaleLowerCase();
      const inserted = await db.insert(contactTags).values(ids.map(contactId=>({ contactId, tag, normalizedTag }))).onConflictDoNothing().returning({ id: contactTags.id });
      return { ok: true, toolCallId, data: { tag, assigned: inserted.length, alreadyAssigned: ids.length-inserted.length, contactCount: ids.length, sendsEmail: false }, audit: audit(ctx, startedAt) };
    } catch { return errorResult(ctx, toolCallId, startedAt); }
  },
};

export const contactTools: AgentToolDefinition[] = [contactTagTool, contactSearchTool, contactAudiencePreviewTool, contactTagAssignTool];
