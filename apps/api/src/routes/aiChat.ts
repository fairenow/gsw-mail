import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { requireAccountPermission } from "../auth/authorize.js";
import { requireUser } from "../auth/middleware.js";
import {
  appendAiMessage,
  completeAiRun,
  createOrResumeConversation,
  decideAiConfirmation,
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
} from "../ai/agentState.js";
import { executeAgentTool, type AgentIntervention } from "../ai/agentExecutor.js";
import { getAiProvider, type AiProviderMessage } from "../ai/providers/index.js";
import { agentMailRegistry } from "../ai/tools/registry.js";
import type { AgentExecutionContext, ProviderToolDefinition } from "../ai/tools/types.js";
import { aiScopes } from "../ai/permissions/types.js";

const chatMessagesSchema = z.array(z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().trim().min(1).max(20_000),
})).min(1).max(24);

const bodySchema = z.object({
  conversationId: z.string().uuid().optional(),
  accountId: z.string().uuid().optional(),
  messages: chatMessagesSchema,
});

const resumeSchema = z.object({
  conversationId: z.string().uuid(),
  accountId: z.string().uuid(),
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
  emit?: ChatStreamEmitter | undefined;
}): Promise<ChatTurnResult> {
  let tools: ProviderToolDefinition[] | undefined;
  let toolContext: AgentExecutionContext | undefined;

  if (input.accountId) {
    tools = agentMailRegistry.providerDefinitions();
    toolContext = {
      userId: input.userId,
      authUserId: input.authUserId,
      accountId: input.accountId,
      headers: input.headers,
      accessToken: input.accessToken,
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

  return {
    conversation,
    providerMessages: input.messages.map((message) => ({
      role: message.role,
      content: message.content,
    })) as AiProviderMessage[],
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

  app.get("/product/chat/permissions", async (req) => {
    const query = z.object({ accountId: z.string().uuid().optional() }).parse(req.query);
    if (query.accountId) await requireAccountPermission(req.user!.id, query.accountId, "read");
    return { grants: await listActiveAiScopes(req.user!.id, query.accountId) };
  });

  app.post("/product/chat/permissions", async (req) => {
    const input = permissionGrantSchema.parse(req.body);
    const requiredPermission = input.scope === "mail.read" || input.scope.endsWith(".read")
      ? "read"
      : input.scope === "mail.write" || input.scope === "mail.send"
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

    const content = outcome.result.ok
      ? "Sent. The email was delivered through GSW Mail."
      : `I couldn't send the email: ${outcome.result.error?.message ?? "the send failed"}`;

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
