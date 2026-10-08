import { z } from "zod";
import { runBrowserAction } from "../browser/provider.js";
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
  error: {
    code: "browser_failed",
    message: error instanceof Error ? error.message : String(error),
    retryable: true,
  },
  audit: { userId: ctx.userId, accountId: ctx.accountId, startedAt, completedAt: new Date().toISOString() },
});

const sessionId = z.string().trim().min(1).max(500).optional();

export const browserSearchTool: AgentToolDefinition = {
  name: "browser.search",
  description: "Search the public web using the isolated browser worker and return research-oriented results without modifying external systems.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string" },
      sessionId: { type: "string" },
    },
    required: ["query"],
    additionalProperties: false,
  },
  requiredScopes: ["browser.read"],
  risk: "read",
  async execute(ctx, rawInput, toolCallId) {
    const startedAt = new Date().toISOString();
    try {
      const input = z.object({ query: z.string().trim().min(1).max(1000), sessionId }).parse(rawInput);
      const result = await runBrowserAction({
        action: "search",
        userId: ctx.userId,
        accountId: ctx.accountId,
        payload: { query: input.query, ...(input.sessionId ? { sessionId: input.sessionId } : {}) },
      });
      return success(ctx, toolCallId, startedAt, result);
    } catch (error) {
      return failure(ctx, toolCallId, startedAt, error);
    }
  },
};

export const browserOpenTool: AgentToolDefinition = {
  name: "browser.open",
  description: "Open a public webpage inside the isolated browser worker. Use only HTTP or HTTPS URLs.",
  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string" },
      sessionId: { type: "string" },
    },
    required: ["url"],
    additionalProperties: false,
  },
  requiredScopes: ["browser.read"],
  risk: "read",
  async execute(ctx, rawInput, toolCallId) {
    const startedAt = new Date().toISOString();
    try {
      const input = z.object({
        url: z.string().url().refine((value) => value.startsWith("https://") || value.startsWith("http://"), "HTTP(S) URL required"),
        sessionId,
      }).parse(rawInput);
      const result = await runBrowserAction({
        action: "open",
        userId: ctx.userId,
        accountId: ctx.accountId,
        payload: { url: input.url, ...(input.sessionId ? { sessionId: input.sessionId } : {}) },
      });
      return success(ctx, toolCallId, startedAt, result);
    } catch (error) {
      return failure(ctx, toolCallId, startedAt, error);
    }
  },
};

export const browserReadTool: AgentToolDefinition = {
  name: "browser.read",
  description: "Read the current webpage or a specific element from an isolated browser session.",
  inputSchema: {
    type: "object",
    properties: {
      sessionId: { type: "string" },
      selector: { type: "string" },
    },
    required: ["sessionId"],
    additionalProperties: false,
  },
  requiredScopes: ["browser.read"],
  risk: "read",
  async execute(ctx, rawInput, toolCallId) {
    const startedAt = new Date().toISOString();
    try {
      const input = z.object({
        sessionId: z.string().trim().min(1).max(500),
        selector: z.string().trim().min(1).max(1000).optional(),
      }).parse(rawInput);
      const result = await runBrowserAction({
        action: "read",
        userId: ctx.userId,
        accountId: ctx.accountId,
        payload: { sessionId: input.sessionId, ...(input.selector ? { selector: input.selector } : {}) },
      });
      return success(ctx, toolCallId, startedAt, result);
    } catch (error) {
      return failure(ctx, toolCallId, startedAt, error);
    }
  },
};

export const browserScreenshotTool: AgentToolDefinition = {
  name: "browser.screenshot",
  description: "Capture the current page in an isolated browser session for visual inspection.",
  inputSchema: {
    type: "object",
    properties: { sessionId: { type: "string" } },
    required: ["sessionId"],
    additionalProperties: false,
  },
  requiredScopes: ["browser.read"],
  risk: "read",
  async execute(ctx, rawInput, toolCallId) {
    const startedAt = new Date().toISOString();
    try {
      const input = z.object({ sessionId: z.string().trim().min(1).max(500) }).parse(rawInput);
      const result = await runBrowserAction({
        action: "screenshot",
        userId: ctx.userId,
        accountId: ctx.accountId,
        payload: { sessionId: input.sessionId },
      });
      return success(ctx, toolCallId, startedAt, result);
    } catch (error) {
      return failure(ctx, toolCallId, startedAt, error);
    }
  },
};

export const browserClickTool: AgentToolDefinition = {
  name: "browser.click",
  description: "Click a non-destructive control in an isolated browser session. This tool must not be used to submit purchases, irreversible forms, account deletions, or other consequential actions.",
  inputSchema: {
    type: "object",
    properties: {
      sessionId: { type: "string" },
      selector: { type: "string" },
      text: { type: "string" },
    },
    required: ["sessionId"],
    additionalProperties: false,
  },
  requiredScopes: ["browser.write"],
  risk: "external",
  async execute(ctx, rawInput, toolCallId) {
    const startedAt = new Date().toISOString();
    try {
      const input = z.object({
        sessionId: z.string().trim().min(1).max(500),
        selector: z.string().trim().min(1).max(1000).optional(),
        text: z.string().trim().min(1).max(500).optional(),
      }).refine((value) => Boolean(value.selector || value.text), "selector or text is required").parse(rawInput);
      const result = await runBrowserAction({
        action: "click",
        userId: ctx.userId,
        accountId: ctx.accountId,
        payload: {
          sessionId: input.sessionId,
          ...(input.selector ? { selector: input.selector } : {}),
          ...(input.text ? { text: input.text } : {}),
          preventSubmit: true,
        },
      });
      return success(ctx, toolCallId, startedAt, result);
    } catch (error) {
      return failure(ctx, toolCallId, startedAt, error);
    }
  },
};

export const browserTypeTool: AgentToolDefinition = {
  name: "browser.type",
  description: "Type text into a field in an isolated browser session without submitting the form.",
  inputSchema: {
    type: "object",
    properties: {
      sessionId: { type: "string" },
      selector: { type: "string" },
      text: { type: "string" },
    },
    required: ["sessionId", "selector", "text"],
    additionalProperties: false,
  },
  requiredScopes: ["browser.write"],
  risk: "external",
  async execute(ctx, rawInput, toolCallId) {
    const startedAt = new Date().toISOString();
    try {
      const input = z.object({
        sessionId: z.string().trim().min(1).max(500),
        selector: z.string().trim().min(1).max(1000),
        text: z.string().max(20_000),
      }).parse(rawInput);
      const result = await runBrowserAction({
        action: "type",
        userId: ctx.userId,
        accountId: ctx.accountId,
        payload: {
          sessionId: input.sessionId,
          selector: input.selector,
          text: input.text,
          preventSubmit: true,
        },
      });
      return success(ctx, toolCallId, startedAt, result);
    } catch (error) {
      return failure(ctx, toolCallId, startedAt, error);
    }
  },
};

export const browserTools: AgentToolDefinition[] = [
  browserSearchTool,
  browserOpenTool,
  browserReadTool,
  browserScreenshotTool,
  browserClickTool,
  browserTypeTool,
];
