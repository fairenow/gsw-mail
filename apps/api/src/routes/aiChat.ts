import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAccountPermission } from "../auth/authorize.js";
import { requireUser } from "../auth/middleware.js";
import { runHetznerChat, type AiProviderMessage } from "../ai/hetzner.js";
import { readOnlyMailRegistry } from "../ai/tools/registry.js";

const bodySchema = z.object({
  accountId: z.string().uuid().optional(),
  messages: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string().trim().min(1).max(20_000),
  })).min(1).max(24),
});

export default async function aiChatRoutes(app: FastifyInstance) {
  await requireUser(app, { optional: false });

  app.post("/product/chat", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req) => {
    const input = bodySchema.parse(req.body);
    const providerMessages: AiProviderMessage[] = input.messages.map((message) => ({
      role: message.role,
      content: message.content,
    }));

    let tools = undefined;
    let toolContext = undefined;
    if (input.accountId) {
      await requireAccountPermission(req.user!.id, input.accountId, "read");
      tools = readOnlyMailRegistry.providerDefinitions();
      toolContext = {
        userId: req.user!.id,
        authUserId: req.authUserId ?? req.user!.id,
        accountId: input.accountId,
        headers: req.headers as Record<string, string>,
      };
    }

    let model = "";
    const toolActivity: Array<{ name: string; ok: boolean }> = [];
    for (let turn = 0; turn < 4; turn += 1) {
      const result = await runHetznerChat(providerMessages, tools);
      model = result.model;

      if (result.toolCalls.length === 0) {
        return {
          message: {
            role: "assistant" as const,
            content: result.content ?? "I couldn't produce a response.",
          },
          model,
          capabilities: {
            actions: false,
            mailboxAccess: Boolean(input.accountId),
            rewriteEmail: true,
          },
          toolActivity,
        };
      }

      if (!toolContext) {
        return {
          message: {
            role: "assistant" as const,
            content: "Select a mailbox before asking me to inspect your mail.",
          },
          model,
          capabilities: {
            actions: false,
            mailboxAccess: false,
            rewriteEmail: true,
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
        const toolResult = await readOnlyMailRegistry.execute(
          call.function.name,
          call.function.arguments,
          toolContext,
          call.id,
        );
        toolActivity.push({ name: call.function.name, ok: toolResult.ok });
        providerMessages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(toolResult),
        });
      }
    }

    return {
      message: {
        role: "assistant" as const,
        content: "I reached the read-only tool limit for this request. Try asking for a narrower mailbox search.",
      },
      model,
      capabilities: {
        actions: false,
        mailboxAccess: Boolean(input.accountId),
        rewriteEmail: true,
      },
      toolActivity,
    };
  });
}
