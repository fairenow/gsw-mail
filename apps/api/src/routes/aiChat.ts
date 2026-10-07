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
  recordAiToolCall,
  recordAiToolResult,
  revokeAiScope,
  startAiRun,
} from "../ai/agentState.js";
import { runHetznerChat, type AiProviderMessage } from "../ai/hetzner.js";
import { readOnlyMailRegistry } from "../ai/tools/registry.js";
import type { AgentExecutionContext, ProviderToolDefinition } from "../ai/tools/types.js";

const bodySchema = z.object({
  conversationId: z.string().uuid().optional(),
  accountId: z.string().uuid().optional(),
  messages: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string().trim().min(1).max(20_000),
  })).min(1).max(24),
});

const permissionGrantSchema = z.object({
  accountId: z.string().uuid().optional(),
  workspaceId: z.string().uuid().optional(),
  scope: z.string().trim().min(1).max(120),
});

const confirmationDecisionSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
});

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
    if (input.accountId) await requireAccountPermission(req.user!.id, input.accountId, "manage");
    const grant = await grantAiScope({
      userId: req.user!.id,
      accountId: input.accountId,
      workspaceId: input.workspaceId,
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

    let tools: ProviderToolDefinition[] | undefined;
    let toolContext: AgentExecutionContext | undefined;
    if (input.accountId) {
      tools = readOnlyMailRegistry.providerDefinitions();
      toolContext = {
        userId: req.user!.id,
        authUserId: req.authUserId ?? req.user!.id,
        accountId: input.accountId,
        headers: req.headers as Record<string, string>,
      };
    }

    const run = await startAiRun({
      conversationId: conversation.id,
      userId: req.user!.id,
      accountId: input.accountId,
      provider: "hetzner",
      metadata: { route: "/product/chat", readOnly: true },
    });

    let model = "";
    const toolActivity: Array<{ name: string; ok: boolean }> = [];

    try {
      for (let turn = 0; turn < 4; turn += 1) {
        const result = await runHetznerChat(providerMessages, tools);
        model = result.model;

        if (result.toolCalls.length === 0) {
          const content = result.content ?? "I couldn't produce a response.";
          await appendAiMessage({
            conversationId: conversation.id,
            role: "assistant",
            content,
            provider: "hetzner",
            model,
            metadata: { toolActivity },
          });
          await completeAiRun(run.id, {
            model,
            metadata: { toolActivity, toolTurns: turn },
          });
          return {
            conversationId: conversation.id,
            message: {
              role: "assistant" as const,
              content,
            },
            model,
            capabilities: {
              actions: false,
              mailboxAccess: Boolean(input.accountId),
              rewriteEmail: true,
              persistentConversation: true,
            },
            toolActivity,
          };
        }

        if (!toolContext) {
          const content = "Select a mailbox before asking me to inspect your mail.";
          await appendAiMessage({
            conversationId: conversation.id,
            role: "assistant",
            content,
            provider: "hetzner",
            model,
          });
          await completeAiRun(run.id, { model, metadata: { toolActivity } });
          return {
            conversationId: conversation.id,
            message: { role: "assistant" as const, content },
            model,
            capabilities: {
              actions: false,
              mailboxAccess: false,
              rewriteEmail: true,
              persistentConversation: true,
            },
            toolActivity,
          };
        }

        providerMessages.push({
          role: "assistant",
          content: result.content,
          tool_calls: result.toolCalls,
        });

        for (const call of result.toolCalls.slice(0, 4)) {
          const definition = readOnlyMailRegistry.definition(call.function.name);
          const ledgerCall = await recordAiToolCall({
            runId: run.id,
            conversationId: conversation.id,
            providerToolCallId: call.id,
            toolName: call.function.name.replaceAll("__", "."),
            risk: definition?.risk ?? "read",
            requiredScopes: definition?.requiredScopes ?? ["mail.read"],
            argumentsJson: call.function.arguments,
          });

          const toolResult = await readOnlyMailRegistry.execute(
            call.function.name,
            call.function.arguments,
            toolContext,
            call.id,
          );

          await recordAiToolResult(ledgerCall.id, toolResult);
          toolActivity.push({ name: call.function.name.replaceAll("__", "."), ok: toolResult.ok });
          providerMessages.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify(toolResult),
          });
        }
      }

      const content = "I reached the read-only tool limit for this request. Try asking for a narrower mailbox search.";
      await appendAiMessage({
        conversationId: conversation.id,
        role: "assistant",
        content,
        provider: "hetzner",
        model,
        metadata: { toolActivity, toolLimitReached: true },
      });
      await completeAiRun(run.id, { model, metadata: { toolActivity, toolLimitReached: true } });
      return {
        conversationId: conversation.id,
        message: {
          role: "assistant" as const,
          content,
        },
        model,
        capabilities: {
          actions: false,
          mailboxAccess: Boolean(input.accountId),
          rewriteEmail: true,
          persistentConversation: true,
        },
        toolActivity,
      };
    } catch (error) {
      await failAiRun(run.id, error);
      throw error;
    }
  });
}
