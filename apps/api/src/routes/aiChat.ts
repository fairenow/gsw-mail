import type { FastifyInstance } from "fastify";
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
import { runHetznerChat, type AiProviderMessage } from "../ai/hetzner.js";
import { readOnlyMailRegistry } from "../ai/tools/registry.js";
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
  actions: false as const,
  mailboxAccess,
  rewriteEmail: true as const,
  persistentConversation: true as const,
});

async function runConversationTurn(input: {
  userId: string;
  authUserId: string;
  accountId?: string;
  headers: Record<string, string>;
  conversationId: string;
  providerMessages: AiProviderMessage[];
}) {
  let tools: ProviderToolDefinition[] | undefined;
  let toolContext: AgentExecutionContext | undefined;

  if (input.accountId) {
    tools = readOnlyMailRegistry.providerDefinitions();
    toolContext = {
      userId: input.userId,
      authUserId: input.authUserId,
      accountId: input.accountId,
      headers: input.headers,
    };
  }

  const run = await startAiRun({
    conversationId: input.conversationId,
    userId: input.userId,
    accountId: input.accountId,
    provider: "hetzner",
    metadata: { route: "/product/chat", readOnly: true },
  });

  let model = "";
  const toolActivity: Array<{ name: string; ok: boolean }> = [];

  try {
    for (let turn = 0; turn < 4; turn += 1) {
      const result = await runHetznerChat(input.providerMessages, tools);
      model = result.model;

      if (result.toolCalls.length === 0) {
        const content = result.content ?? "I couldn't produce a response.";
        await appendAiMessage({
          conversationId: input.conversationId,
          role: "assistant",
          content,
          provider: "hetzner",
          model,
          metadata: { toolActivity },
        });
        await completeAiRun(run.id, { model, metadata: { toolActivity, toolTurns: turn } });
        return {
          conversationId: input.conversationId,
          message: { role: "assistant" as const, content },
          intervention: null as AgentIntervention | null,
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
          provider: "hetzner",
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
        const definition = readOnlyMailRegistry.definition(call.function.name);
        const semanticName = call.function.name.replaceAll("__", ".");
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
          registry: readOnlyMailRegistry,
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
      provider: "hetzner",
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
    const requiredPermission = input.scope === "mail.read" || input.scope.endsWith(".read") ? "read" : input.scope === "mail.send" ? "send" : "manage";
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
    const confirmation = await decideAiConfirmation(req.user!.id, params.id, input.decision);
    return { confirmation };
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
      conversationId: input.conversationId,
      providerMessages,
    });
  });

  app.post("/product/chat", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req) => {
    const input = bodySchema.parse(req.body);
    const latestUserMessage = [...input.messages].reverse().find((message) => message.role === "user");
    if (!latestUserMessage) throw new Error("chat request requires a user message");

    if (input.accountId) await requireAccountPermission(req.user!.id, input.accountId, "read");

    const conversation = await createOrResumeConversation({
      userId: req.user!.id,
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

    const providerMessages: AiProviderMessage[] = input.messages.map((message) => ({
      role: message.role,
      content: message.content,
    }));

    return runConversationTurn({
      userId: req.user!.id,
      authUserId: req.authUserId ?? req.user!.id,
      accountId: input.accountId,
      headers: req.headers as Record<string, string>,
      conversationId: conversation.id,
      providerMessages,
    });
  });
}
