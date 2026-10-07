import { z } from "zod";
import { searchWorkspace } from "../searchService.js";
import type { AgentExecutionContext, AgentToolDefinition, AgentToolResult } from "./types.js";

const inputSchema = z.object({
  query: z.string().trim().min(1).max(500),
  limit: z.number().int().min(1).max(25).optional(),
});

const success = <T>(ctx: AgentExecutionContext, toolCallId: string, startedAt: string, data: T): AgentToolResult<T> => ({
  ok: true,
  toolCallId,
  data,
  audit: {
    userId: ctx.userId,
    accountId: ctx.accountId,
    startedAt,
    completedAt: new Date().toISOString(),
  },
});

const failure = (ctx: AgentExecutionContext, toolCallId: string, startedAt: string, error: unknown): AgentToolResult => ({
  ok: false,
  toolCallId,
  error: {
    code: "tool_failed",
    message: error instanceof Error ? error.message : String(error),
    retryable: false,
  },
  audit: {
    userId: ctx.userId,
    accountId: ctx.accountId,
    startedAt,
    completedAt: new Date().toISOString(),
  },
});

export const workspaceSearchTool: AgentToolDefinition = {
  name: "search.workspace",
  description: [
    "Search across the user's indexed GSW mailbox and saved GSW Chat history in one query.",
    "Use this for broad recall questions, fuzzy topic discovery, or when the user remembers an idea but not an exact sender/subject.",
    "Results are retrieval candidates; use mail.read or mail.read_thread before making claims that require full email contents.",
  ].join(" "),
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Natural search terms or a concise semantic topic phrase." },
      limit: { type: "integer", minimum: 1, maximum: 25 },
    },
    required: ["query"],
    additionalProperties: false,
  },
  requiredScopes: ["mail.read"],
  risk: "read",
  async execute(ctx, rawInput, toolCallId) {
    const startedAt = new Date().toISOString();
    try {
      const input = inputSchema.parse(rawInput);
      const result = await searchWorkspace({
        userId: ctx.userId,
        accountId: ctx.accountId,
        query: input.query,
        limit: input.limit,
      });
      return success(ctx, toolCallId, startedAt, result);
    } catch (error) {
      return failure(ctx, toolCallId, startedAt, error);
    }
  },
};

export const searchTools: AgentToolDefinition[] = [workspaceSearchTool];
