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

const activityInput = z.object({
  startIso: z.string().datetime(),
  endIso: z.string().datetime(),
  mailboxes: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
});

const readInput = z.object({
  messageId: z.string().min(1).max(1_000),
});

const threadInput = z.object({
  threadId: z.string().min(1).max(1_000),
});

const draftFields = {
  to: z.array(z.string().email()).min(1).max(100),
  cc: z.array(z.string().email()).max(100).optional(),
  bcc: z.array(z.string().email()).max(100).optional(),
  subject: z.string().max(998).optional(),
  textBody: z.string().max(200_000).optional(),
  htmlBody: z.string().max(500_000).optional(),
  replyTo: z.string().email().optional(),
  inReplyTo: z.string().max(2_000).optional(),
  references: z.string().max(8_000).optional(),
};

const createDraftInput = z.object(draftFields);
const updateDraftInput = z.object({
  draftId: z.string().min(1).max(1_000),
  ...draftFields,
});
const sendDraftInput = z.object({
  draftId: z.string().min(1).max(1_000),
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

export const mailActivityTool: AgentToolDefinition = {
  name: "mail.activity",
  description: "Read mailbox activity across Inbox, Sent, Drafts, Outbox, and Trash for an exact time window. Use this for requests like 'what happened in email yesterday', daily email summaries, or activity recaps instead of relying on a keyword search in one folder.",
  inputSchema: {
    type: "object",
    properties: {
      startIso: { type: "string", description: "Inclusive ISO-8601 start of the requested period, including timezone offset when known." },
      endIso: { type: "string", description: "Exclusive ISO-8601 end of the requested period, including timezone offset when known." },
      mailboxes: { type: "array", items: { type: "string" }, description: "Optional mailbox names/roles. Defaults to Inbox, Sent, Drafts, Outbox, and Trash." },
    },
    required: ["startIso", "endIso"],
    additionalProperties: false,
  },
  requiredScopes: ["mail.read"],
  risk: "read",
  async execute(ctx, rawInput, toolCallId) {
    const startedAt = new Date().toISOString();
    try {
      const input = activityInput.parse(rawInput);
      const mail = createMailService(ctx);
      const activity = await mail.activity(ctx.accountId, input.startIso, input.endIso, input.mailboxes);
      return success(ctx, toolCallId, startedAt, activity);
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
      const summaries = await mail.readThread(ctx.accountId, input.threadId);
      const messages = await Promise.all(
        summaries.slice(-20).map((summary) => mail.readMessage(ctx.accountId, summary.engineId, false)),
      );
      return success(ctx, toolCallId, startedAt, {
        threadId: input.threadId,
        count: summaries.length,
        messages: messages.map((message) => ({
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

export const mailCreateDraftTool: AgentToolDefinition = {
  name: "mail.create_draft",
  description: "Create a real draft in the user's selected GSW mailbox. Use this when the user explicitly asks to draft or prepare an email in their mailbox. This does not send the email.",
  inputSchema: {
    type: "object",
    properties: {
      to: { type: "array", items: { type: "string" }, minItems: 1 },
      cc: { type: "array", items: { type: "string" } },
      bcc: { type: "array", items: { type: "string" } },
      subject: { type: "string" },
      textBody: { type: "string" },
      htmlBody: { type: "string" },
      replyTo: { type: "string" },
      inReplyTo: { type: "string" },
      references: { type: "string" },
    },
    required: ["to"],
    additionalProperties: false,
  },
  requiredScopes: ["mail.write"],
  risk: "reversible_write",
  async execute(ctx, rawInput, toolCallId) {
    const startedAt = new Date().toISOString();
    try {
      const input = createDraftInput.parse(rawInput);
      const mail = createMailService(ctx);
      const result = await mail.createDraft(ctx.accountId, input);
      return success(ctx, toolCallId, startedAt, result);
    } catch (error) {
      return failure(ctx, toolCallId, startedAt, error);
    }
  },
};

export const mailUpdateDraftTool: AgentToolDefinition = {
  name: "mail.update_draft",
  description: "Update an existing draft in the user's selected GSW mailbox. This does not send the email.",
  inputSchema: {
    type: "object",
    properties: {
      draftId: { type: "string" },
      to: { type: "array", items: { type: "string" }, minItems: 1 },
      cc: { type: "array", items: { type: "string" } },
      bcc: { type: "array", items: { type: "string" } },
      subject: { type: "string" },
      textBody: { type: "string" },
      htmlBody: { type: "string" },
      replyTo: { type: "string" },
      inReplyTo: { type: "string" },
      references: { type: "string" },
    },
    required: ["draftId", "to"],
    additionalProperties: false,
  },
  requiredScopes: ["mail.write"],
  risk: "reversible_write",
  async execute(ctx, rawInput, toolCallId) {
    const startedAt = new Date().toISOString();
    try {
      const input = updateDraftInput.parse(rawInput);
      const { draftId, ...draft } = input;
      const mail = createMailService(ctx);
      const result = await mail.updateDraft(ctx.accountId, draftId, draft);
      return success(ctx, toolCallId, startedAt, result);
    } catch (error) {
      return failure(ctx, toolCallId, startedAt, error);
    }
  },
};

export const mailSendDraftTool: AgentToolDefinition = {
  name: "mail.send_draft",
  description: "Send an existing GSW Mail draft. Use only when the user explicitly asks to send a draft or email. This is an external action and requires confirmation before execution.",
  inputSchema: {
    type: "object",
    properties: {
      draftId: { type: "string" },
    },
    required: ["draftId"],
    additionalProperties: false,
  },
  requiredScopes: ["mail.send"],
  risk: "external",
  async execute(ctx, rawInput, toolCallId) {
    const startedAt = new Date().toISOString();
    try {
      const input = sendDraftInput.parse(rawInput);
      const mail = createMailService(ctx);
      const result = await mail.sendDraft(ctx.accountId, input.draftId, `agent:${toolCallId}`);
      return success(ctx, toolCallId, startedAt, result);
    } catch (error) {
      return failure(ctx, toolCallId, startedAt, error);
    }
  },
};

export const agentMailTools: AgentToolDefinition[] = [
  mailActivityTool,
  mailSearchTool,
  mailReadTool,
  mailReadThreadTool,
  mailCreateDraftTool,
  mailUpdateDraftTool,
  mailSendDraftTool,
];

export const readOnlyMailTools: AgentToolDefinition[] = [
  mailActivityTool,
  mailSearchTool,
  mailReadTool,
  mailReadThreadTool,
];
