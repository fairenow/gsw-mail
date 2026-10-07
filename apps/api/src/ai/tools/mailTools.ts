import { z } from "zod";
import { createMailService } from "../../services/mailService.js";
import type { AgentExecutionContext, AgentToolDefinition, AgentToolResult } from "./types.js";

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

const searchInput = z.object({
  query: z.string().trim().min(1).max(500),
  mailbox: z.string().trim().min(1).max(100).optional(),
});

const readInput = z.object({
  messageId: z.string().min(1).max(1_000),
});

const threadInput = z.object({
  threadId: z.string().min(1).max(1_000),
});

export const mailSearchTool: AgentToolDefinition = {
  name: "mail.search",
  description: "Search the user's currently selected mailbox for messages matching a natural-language query. Use this before reading a message when the message ID is not already known.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search text such as sender name, email address, subject words, or message terms." },
      mailbox: { type: "string", description: "Optional mailbox/folder name such as Inbox, Sent, Archive, or Trash." },
    },
    required: ["query"],
    additionalProperties: false,
  },
  requiredScopes: ["mail.read"],
  risk: "read",
  async execute(ctx, rawInput, toolCallId) {
    const startedAt = new Date().toISOString();
    try {
      const input = searchInput.parse(rawInput);
      const mail = createMailService(ctx);
      const messages = await mail.search(ctx.accountId, input.query, input.mailbox);
      return success(ctx, toolCallId, startedAt, {
        count: messages.length,
        messages: messages.slice(0, 20).map((message) => ({
          messageId: message.engineId,
          threadId: message.threadId,
          subject: message.subject,
          date: message.date,
          from: message.from,
          to: message.to,
          snippet: message.snippet,
          mailbox: message.mailbox,
          read: message.read,
        })),
      });
    } catch (error) {
      return failure(ctx, toolCallId, startedAt, error);
    }
  },
};

export const mailReadTool: AgentToolDefinition = {
  name: "mail.read",
  description: "Read one email from the user's currently selected mailbox after its message ID is known.",
  inputSchema: {
    type: "object",
    properties: {
      messageId: { type: "string", description: "The message ID returned by mail.search." },
    },
    required: ["messageId"],
    additionalProperties: false,
  },
  requiredScopes: ["mail.read"],
  risk: "read",
  async execute(ctx, rawInput, toolCallId) {
    const startedAt = new Date().toISOString();
    try {
      const input = readInput.parse(rawInput);
      const mail = createMailService(ctx);
      const message = await mail.readMessage(ctx.accountId, input.messageId, false);
      return success(ctx, toolCallId, startedAt, {
        messageId: message.engineId,
        threadId: message.threadId,
        subject: message.subject,
        date: message.date,
        from: message.from,
        to: message.to,
        cc: message.cc,
        textBody: message.textBody,
        htmlBody: message.textBody ? undefined : message.htmlBody,
        attachments: message.attachments,
      });
    } catch (error) {
      return failure(ctx, toolCallId, startedAt, error);
    }
  },
};

export const mailReadThreadTool: AgentToolDefinition = {
  name: "mail.read_thread",
  description: "Read the full conversation thread for a known thread ID from the user's currently selected mailbox.",
  inputSchema: {
    type: "object",
    properties: {
      threadId: { type: "string", description: "The thread ID returned by mail.search or mail.read." },
    },
    required: ["threadId"],
    additionalProperties: false,
  },
  requiredScopes: ["mail.read"],
  risk: "read",
  async execute(ctx, rawInput, toolCallId) {
    const startedAt = new Date().toISOString();
    try {
      const input = threadInput.parse(rawInput);
      const mail = createMailService(ctx);
      const messages = await mail.readThread(ctx.accountId, input.threadId);
      return success(ctx, toolCallId, startedAt, {
        threadId: input.threadId,
        count: messages.length,
        messages: messages.slice(-20).map((message) => ({
          messageId: message.engineId,
          subject: message.subject,
          date: message.date,
          from: message.from,
          to: message.to,
          cc: message.cc,
          textBody: message.textBody,
          htmlBody: message.textBody ? undefined : message.htmlBody,
        })),
      });
    } catch (error) {
      return failure(ctx, toolCallId, startedAt, error);
    }
  },
};

export const readOnlyMailTools: AgentToolDefinition[] = [
  mailSearchTool,
  mailReadTool,
  mailReadThreadTool,
];
