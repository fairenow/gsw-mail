import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { requireAccountPermission } from "../auth/authorize.js";
import { requireUser } from "../auth/middleware.js";
import {
  appendAiMessage,
  completeAiRun,
  createOrResumeConversation,
  decideAiConfirmation,
  deleteAiConversation,
  failAiRun,
  grantAiScope,
  getAiConfirmationExecution,
  listActiveAiScopes,
  listConversationMessages,
  listRecentConversations,
  markAiToolCallStatus,
  pauseAiRun,
  recordAiToolCall,
  recordAiToolResult,
  revokeAiScope,
  startAiRun,
  updateAiConversation,
} from "../ai/agentState.js";
import { executeAgentTool, type AgentIntervention } from "../ai/agentExecutor.js";
import { getAiProvider, type AiProviderMessage } from "../ai/providers/index.js";
import { agentMailRegistry } from "../ai/tools/registry.js";
import type { AgentExecutionContext, ProviderToolDefinition } from "../ai/tools/types.js";
import { aiScopes } from "../ai/permissions/types.js";
import { getAiCapabilitySettings, isAiScopeGloballyEnabled } from "../ai/capabilities.js";
import { forbidden } from "../lib/errors.js";

const chatMessagesSchema = z.array(z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().trim().min(1).max(20_000),
})).min(1).max(24);

const bodySchema = z.object({
  conversationId: z.string().uuid().optional(),
  accountId: z.string().uuid().optional(),
  timeZone: z.string().trim().min(1).max(100).optional(),
  localDateTime: z.string().trim().min(1).max(200).optional(),
  messages: chatMessagesSchema,
});

const resumeSchema = z.object({
  conversationId: z.string().uuid(),
  accountId: z.string().uuid(),
  timeZone: z.string().trim().min(1).max(100).optional(),
  localDateTime: z.string().trim().min(1).max(200).optional(),
});

const permissionGrantSchema = z.object({
  accountId: z.string().uuid(),
  scope: z.enum(aiScopes),
});

const confirmationDecisionSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
});

const capabilities = (mailboxAccess: boolean) => ({
  actions: true as const,
  mailboxAccess,
  rewriteEmail: true as const,
  persistentConversation: true as const,
  streamingExecution: true as const,
});

type ChatTurnResult = {
  conversationId: string;
  message: { role: "assistant"; content: string } | null;
  intervention: AgentIntervention | null;
  model: string;
  capabilities: ReturnType<typeof capabilities>;
  toolActivity: Array<{ name: string; ok: boolean }>;
};

type ChatStreamStatus = {
  type: "status";
  phase: "thinking" | "tool_started" | "tool_completed";
  label: string;
  toolName?: string;
  ok?: boolean;
};

type ChatStreamEvent =
  | ChatStreamStatus
  | { type: "result"; response: ChatTurnResult }
  | { type: "error"; message: string };

type ChatStreamEmitter = (event: ChatStreamStatus) => void;

const toolLabel = (toolName: string): string => {
  switch (toolName) {
    case "mail.search": return "Searching your mailbox";
    case "mail.read": return "Reading the matching email";
    case "mail.read_thread": return "Reading the conversation";
    case "mail.create_draft": return "Creating a draft";
    case "mail.update_draft": return "Updating the draft";
    case "mail.send_draft": return "Preparing to send the draft";
    case "automations.create": return "Scheduling your task";
    case "automations.list": return "Checking your scheduled tasks";
    case "automations.update": return "Updating your scheduled task";
    case "automations.delete": return "Removing your scheduled task";
    case "search.workspace": return "Searching mail and chat history";
    case "contacts.tags": return "Checking contact groups";
    case "campaign.create": return "Preparing your campaign";
    case "campaign.list": return "Checking your campaigns";
    case "campaign.read": return "Reviewing your campaign";
    case "campaign.launch": return "Launching your campaign";
    case "templates.list": return "Checking your email templates";
    case "templates.create": return "Creating your email template";
    case "templates.update": return "Updating your email template";
    case "templates.select": return "Selecting your default email template";
    default: return "Working with your mailbox";
  }
};

const openEventStream = (reply: FastifyReply) => {
  reply.hijack();
  reply.raw.statusCode = 200;
  reply.raw.setHeader("content-type", "text/event-stream; charset=utf-8");
  reply.raw.setHeader("cache-control", "no-cache, no-transform");
  reply.raw.setHeader("connection", "keep-alive");
  reply.raw.setHeader("x-accel-buffering", "no");
  reply.raw.flushHeaders?.();

  const send = (event: ChatStreamEvent) => {
    if (reply.raw.destroyed || reply.raw.writableEnded) return;
    reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
  };
  return {
    send,
    close: () => {
      if (!reply.raw.destroyed && !reply.raw.writableEnded) reply.raw.end();
    },
  };
};

async function runConversationTurn(input: {
  userId: string;
  authUserId: string;
  accountId?: string | undefined;
  headers: Record<string, string>;
  accessToken?: string | undefined;
  conversationId: string;
  providerMessages: AiProviderMessage[];
  timeZone?: string | undefined;
  emit?: ChatStreamEmitter | undefined;
}): Promise<ChatTurnResult> {
  let tools: ProviderToolDefinition[] | undefined;
  let toolContext: AgentExecutionContext | undefined;
  const capabilitySettings = await getAiCapabilitySettings(input.userId);
  if (!capabilitySettings.enabled) throw forbidden("GSW AI is disabled in Settings.");

  if (input.accountId) {
    tools = agentMailRegistry.providerDefinitions((tool) => tool.requiredScopes.every((scope) => isAiScopeGloballyEnabled(capabilitySettings, scope)));
    toolContext = {
      userId: input.userId,
      authUserId: input.authUserId,
      accountId: input.accountId,
      headers: input.headers,
      accessToken: input.accessToken,
      conversationId: input.conversationId,
      timeZone: input.timeZone,
    };
  }

  const provider = getAiProvider();
  const run = await startAiRun({
    conversationId: input.conversationId,
    userId: input.userId,
    accountId: input.accountId,
    provider: provider.id,
    metadata: { route: "/product/chat", agentActions: true, streamingExecution: Boolean(input.emit) },
  });

  let model = "";
  const toolActivity: Array<{ name: string; ok: boolean }> = [];

  try {
    for (let turn = 0; turn < 4; turn += 1) {
      input.emit?.({
        type: "status",
        phase: "thinking",
        label: turn === 0 ? "Thinking" : "Reviewing what I found",
      });

      const result = await provider.run({ messages: input.providerMessages, tools });
      model = result.model;

      if (result.toolCalls.length === 0) {
        const content = result.content ?? "I couldn't produce a response.";
        await appendAiMessage({
          conversationId: input.conversationId,
          role: "assistant",
          content,
          provider: provider.id,
          model,
          metadata: { toolActivity },
        });
        await completeAiRun(run.id, { model, metadata: { toolActivity, toolTurns: turn } });
        return {
          conversationId: input.conversationId,
          message: { role: "assistant" as const, content },
          intervention: null,
          model,
          capabilities: capabilities(Boolean(input.accountId)),
          toolActivity,
        };
      }

      if (!toolContext) {
        const content = "Select a mailbox before asking me to inspect your mail.";
        await appendAiMessage({
          conversationId: input.conversationId,
          role: "assistant",
          content,
          provider: provider.id,
          model,
        });
        await completeAiRun(run.id, { model, metadata: { toolActivity } });
        return {
          conversationId: input.conversationId,
          message: { role: "assistant" as const, content },
          intervention: null,
          model,
          capabilities: capabilities(false),
          toolActivity,
        };
      }

      input.providerMessages.push({
        role: "assistant",
        content: result.content,
        tool_calls: result.toolCalls,
      });

      for (const call of result.toolCalls.slice(0, 4)) {
        const definition = agentMailRegistry.definition(call.function.name);
        const semanticName = call.function.name.replaceAll("__", ".");
        const label = toolLabel(semanticName);

        input.emit?.({
          type: "status",
          phase: "tool_started",
          label,
          toolName: semanticName,
        });

        const ledgerCall = await recordAiToolCall({
          runId: run.id,
          conversationId: input.conversationId,
          providerToolCallId: call.id,
          toolName: semanticName,
          risk: definition?.risk ?? "read",
          requiredScopes: definition?.requiredScopes ?? ["mail.read"],
          argumentsJson: call.function.arguments,
        });

        const outcome = await executeAgentTool({
          registry: agentMailRegistry,
          providerToolName: call.function.name,
          rawArguments: call.function.arguments,
          ctx: toolContext,
          providerToolCallId: call.id,
          ledgerToolCallId: ledgerCall.id,
          conversationId: input.conversationId,
          runId: run.id,
        });

        if (outcome.kind === "intervention") {
          const status = outcome.intervention.type === "permission" ? "awaiting_permission" : "awaiting_confirmation";
          await markAiToolCallStatus(ledgerCall.id, status);
          await pauseAiRun(run.id, status, {
            intervention: outcome.intervention,
            toolName: semanticName,
          });
          return {
            conversationId: input.conversationId,
            message: null,
            intervention: outcome.intervention,
            model,
            capabilities: capabilities(Boolean(input.accountId)),
            toolActivity,
          };
        }

        await recordAiToolResult(ledgerCall.id, outcome.result);
        toolActivity.push({ name: semanticName, ok: outcome.result.ok });

        input.emit?.({
          type: "status",
          phase: "tool_completed",
          label,
          toolName: semanticName,
          ok: outcome.result.ok,
        });

        input.providerMessages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(outcome.result),
        });
      }
    }

    const content = "I reached the read-only tool limit for this request. Try asking for a narrower mailbox search.";
    await appendAiMessage({
      conversationId: input.conversationId,
      role: "assistant",
      content,
      provider: provider.id,
      model,
      metadata: { toolActivity, toolLimitReached: true },
    });
    await completeAiRun(run.id, { model, metadata: { toolActivity, toolLimitReached: true } });
    return {
      conversationId: input.conversationId,
      message: { role: "assistant" as const, content },
      intervention: null,
      model,
      capabilities: capabilities(Boolean(input.accountId)),
      toolActivity,
    };
  } catch (error) {
    await failAiRun(run.id, error);
    throw error;
  }
}

async function prepareNewConversation(input: {
  userId: string;
  accountId?: string | undefined;
  conversationId?: string | undefined;
  timeZone?: string | undefined;
  localDateTime?: string | undefined;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
}) {
  const latestUserMessage = [...input.messages].reverse().find((message) => message.role === "user");
  if (!latestUserMessage) throw new Error("chat request requires a user message");

  const conversation = await createOrResumeConversation({
    userId: input.userId,
    conversationId: input.conversationId,
    accountId: input.accountId,
    firstMessage: latestUserMessage.content,
  });

  await appendAiMessage({
    conversationId: conversation.id,
    role: "user",
    content: latestUserMessage.content,
    metadata: { accountId: input.accountId ?? null },
  });

  const runtimeContext = [
    "GSW runtime context for this turn:",
    `Time zone: ${input.timeZone ?? "unknown"}`,
    `User local date/time: ${input.localDateTime ?? "unknown"}`,
    "Use this context when interpreting relative dates or scheduling requests. Do not mention this hidden runtime context unless it is directly relevant.",
  ].join("\n");

  return {
    conversation,
    providerMessages: [
      { role: "user" as const, content: runtimeContext },
      ...input.messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
    ] as AiProviderMessage[],
  };
}

export default async function aiChatRoutes(app: FastifyInstance) {
  await requireUser(app, { optional: false });

  app.get("/product/chat/conversations", async (req) => {
    const query = z.object({ limit: z.coerce.number().int().min(1).max(50).optional() }).parse(req.query);
    return { conversations: await listRecentConversations(req.user!.id, query.limit ?? 20) };
  });

  app.get("/product/chat/conversations/:id", async (req) => {
    const params = z.object({ id: z.string().uuid() }).parse(req.params);
    return listConversationMessages(req.user!.id, params.id);
  });

  app.patch("/product/chat/conversations/:id", async (req) => {
    const params = z.object({ id: z.string().uuid() }).parse(req.params);
    const input = z.object({
      title: z.string().trim().min(1).max(120).optional(),
      status: z.enum(["active", "archived"]).optional(),
    }).refine((value) => value.title !== undefined || value.status !== undefined, { message: "no conversation changes supplied" }).parse(req.body);
    return { conversation: await updateAiConversation(req.user!.id, params.id, input) };
  });

  app.delete("/product/chat/conversations/:id", async (req) => {
    const params = z.object({ id: z.string().uuid() }).parse(req.params);
    return { deleted: await deleteAiConversation(req.user!.id, params.id) };
  });

  app.get("/product/chat/permissions", async (req) => {
    const query = z.object({ accountId: z.string().uuid().optional() }).parse(req.query);
    if (query.accountId) await requireAccountPermission(req.user!.id, query.accountId, "read");
    return { grants: await listActiveAiScopes(req.user!.id, query.accountId) };
  });

  app.post("/product/chat/permissions", async (req) => {
    const input = permissionGrantSchema.parse(req.body);
    const capabilitySettings = await getAiCapabilitySettings(req.user!.id);
    if (!isAiScopeGloballyEnabled(capabilitySettings, input.scope)) {
      throw forbidden("This AI capability is disabled in Settings.");
    }
    const requiredPermission = input.scope === "mail.read"
      || input.scope.endsWith(".read")
      || input.scope === "automations.write"
      || input.scope === "templates.write"
      || input.scope === "settings.write"
      || input.scope === "signatures.write"
      ? "read"
      : input.scope === "mail.write" || input.scope === "mail.send" || input.scope === "campaign.write" || input.scope === "campaign.send"
        ? "send"
        : "manage";
    await requireAccountPermission(req.user!.id, input.accountId, requiredPermission);
    const grant = await grantAiScope({
      userId: req.user!.id,
      accountId: input.accountId,
      scope: input.scope,
    });
    return { grant };
  });

  app.delete("/product/chat/permissions/:id", async (req) => {
    const params = z.object({ id: z.string().uuid() }).parse(req.params);
    const grant = await revokeAiScope(req.user!.id, params.id);
    return { grant };
  });

  app.post("/product/chat/confirmations/:id", async (req) => {
    const params = z.object({ id: z.string().uuid() }).parse(req.params);
    const input = confirmationDecisionSchema.parse(req.body);
    const execution = await getAiConfirmationExecution(req.user!.id, params.id);
    const confirmation = await decideAiConfirmation(req.user!.id, params.id, input.decision);

    if (input.decision === "rejected") {
      await markAiToolCallStatus(execution.toolCall.id, "rejected");
      await completeAiRun(execution.run.id, {
        model: execution.run.model ?? undefined,
        metadata: { confirmationId: params.id, rejected: true },
      });
      const content = "Okay — I did not send the email.";
      await appendAiMessage({
        conversationId: execution.toolCall.conversationId,
        role: "assistant",
        content,
        provider: execution.run.provider,
        model: execution.run.model ?? undefined,
        metadata: { confirmationId: params.id, rejected: true },
      });
      return {
        confirmation,
        execution: {
          conversationId: execution.toolCall.conversationId,
          message: { role: "assistant" as const, content },
        },
      };
    }

    if (!execution.run.accountId) throw new Error("confirmed AI action has no mailbox context");
    const toolContext: AgentExecutionContext = {
      userId: req.user!.id,
      authUserId: req.authUserId ?? req.user!.id,
      accountId: execution.run.accountId,
      headers: req.headers as Record<string, string>,
      accessToken: req.accessToken,
      conversationId: execution.toolCall.conversationId,
    };
    const rawArguments = JSON.stringify(execution.toolCall.arguments ?? {});
    const outcome = await executeAgentTool({
      registry: agentMailRegistry,
      providerToolName: execution.toolCall.toolName,
      rawArguments,
      ctx: toolContext,
      providerToolCallId: execution.toolCall.providerToolCallId,
      ledgerToolCallId: execution.toolCall.id,
      conversationId: execution.toolCall.conversationId,
      runId: execution.run.id,
      confirmationApproved: true,
    });

    if (outcome.kind !== "result") throw new Error("confirmed action unexpectedly requested another intervention");
    await recordAiToolResult(execution.toolCall.id, outcome.result);

    const resultData = outcome.result.data && typeof outcome.result.data === "object"
      ? outcome.result.data as Record<string, unknown>
      : {};
    const content = outcome.result.ok
      ? execution.toolCall.toolName === "mail.send_draft"
        ? "Sent. The email was queued for delivery through GSW Mail."
        : execution.toolCall.toolName === "automations.create"
          ? `Scheduled. ${String(resultData.title ?? "Your task")} will run next at ${String(resultData.nextRunAt ?? "the configured time")}.`
          : execution.toolCall.toolName === "campaign.launch"
            ? `Campaign launch queued ${String(resultData.sent ?? 0)} message(s)${Number(resultData.failed ?? 0) > 0 ? ` with ${String(resultData.failed)} failure(s)` : ""}.`
            : "Approved action completed."
      : execution.toolCall.toolName === "mail.send_draft"
        ? `I couldn't send the email: ${outcome.result.error?.message ?? "the send failed"}`
        : `I couldn't complete that action: ${outcome.result.error?.message ?? "the action failed"}`;

    await appendAiMessage({
      conversationId: execution.toolCall.conversationId,
      role: "assistant",
      content,
      provider: execution.run.provider,
      model: execution.run.model ?? undefined,
      metadata: { confirmationId: params.id, toolName: execution.toolCall.toolName, ok: outcome.result.ok },
    });
    await completeAiRun(execution.run.id, {
      model: execution.run.model ?? undefined,
      metadata: { confirmationId: params.id, toolName: execution.toolCall.toolName, ok: outcome.result.ok },
    });

    return {
      confirmation,
      execution: {
        conversationId: execution.toolCall.conversationId,
        message: { role: "assistant" as const, content },
        toolResult: outcome.result,
      },
    };
  });

  app.post("/product/chat/resume", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req) => {
    const input = resumeSchema.parse(req.body);
    await requireAccountPermission(req.user!.id, input.accountId, "read");
    const detail = await listConversationMessages(req.user!.id, input.conversationId);
    if (detail.conversation.accountId && detail.conversation.accountId !== input.accountId) {
      throw new Error("AI conversation belongs to a different mailbox");
    }
    const providerMessages: AiProviderMessage[] = detail.messages
      .filter((message) => message.role === "user" || message.role === "assistant")
      .slice(-24)
      .map((message) => ({ role: message.role as "user" | "assistant", content: message.content }));

    return runConversationTurn({
      userId: req.user!.id,
      authUserId: req.authUserId ?? req.user!.id,
      accountId: input.accountId,
      headers: req.headers as Record<string, string>,
      accessToken: req.accessToken,
      conversationId: input.conversationId,
      providerMessages,
      timeZone: input.timeZone,
    });
  });

  app.post("/product/chat/resume/stream", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req, reply) => {
    const input = resumeSchema.parse(req.body);
    await requireAccountPermission(req.user!.id, input.accountId, "read");
    const detail = await listConversationMessages(req.user!.id, input.conversationId);
    if (detail.conversation.accountId && detail.conversation.accountId !== input.accountId) {
      throw new Error("AI conversation belongs to a different mailbox");
    }
    const providerMessages: AiProviderMessage[] = detail.messages
      .filter((message) => message.role === "user" || message.role === "assistant")
      .slice(-24)
      .map((message) => ({ role: message.role as "user" | "assistant", content: message.content }));

    const stream = openEventStream(reply);
    try {
      const response = await runConversationTurn({
        userId: req.user!.id,
        authUserId: req.authUserId ?? req.user!.id,
        accountId: input.accountId,
        headers: req.headers as Record<string, string>,
        conversationId: input.conversationId,
        providerMessages,
        timeZone: input.timeZone,
        emit: stream.send,
      });
      stream.send({ type: "result", response });
    } catch (error) {
      req.log.error(error);
      stream.send({ type: "error", message: error instanceof Error ? error.message : "Chat failed to respond." });
    } finally {
      stream.close();
    }
  });

  app.post("/product/chat", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req) => {
    const input = bodySchema.parse(req.body);
    if (input.accountId) await requireAccountPermission(req.user!.id, input.accountId, "read");
    const prepared = await prepareNewConversation({
      userId: req.user!.id,
      accountId: input.accountId,
      conversationId: input.conversationId,
      messages: input.messages,
      timeZone: input.timeZone,
      localDateTime: input.localDateTime,
    });

    return runConversationTurn({
      userId: req.user!.id,
      authUserId: req.authUserId ?? req.user!.id,
      accountId: input.accountId,
      headers: req.headers as Record<string, string>,
      accessToken: req.accessToken,
      conversationId: prepared.conversation.id,
      providerMessages: prepared.providerMessages,
    });
  });

  app.post("/product/chat/stream", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req, reply) => {
    const input = bodySchema.parse(req.body);
    if (input.accountId) await requireAccountPermission(req.user!.id, input.accountId, "read");
    const prepared = await prepareNewConversation({
      userId: req.user!.id,
      accountId: input.accountId,
      conversationId: input.conversationId,
      messages: input.messages,
      timeZone: input.timeZone,
      localDateTime: input.localDateTime,
    });

    const stream = openEventStream(reply);
    try {
      const response = await runConversationTurn({
        userId: req.user!.id,
        authUserId: req.authUserId ?? req.user!.id,
        accountId: input.accountId,
        headers: req.headers as Record<string, string>,
        conversationId: prepared.conversation.id,
        providerMessages: prepared.providerMessages,
        emit: stream.send,
      });
      stream.send({ type: "result", response });
    } catch (error) {
      req.log.error(error);
      stream.send({ type: "error", message: error instanceof Error ? error.message : "Chat failed to respond." });
    } finally {
      stream.close();
    }
  });
}
