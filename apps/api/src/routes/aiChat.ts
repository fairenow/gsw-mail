import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser } from "../auth/middleware.js";
import { runHetznerChat } from "../ai/hetzner.js";

const bodySchema = z.object({
  messages: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string().trim().min(1).max(20_000),
  })).min(1).max(24),
});

export default async function aiChatRoutes(app: FastifyInstance) {
  await requireUser(app, { optional: false });

  app.post("/product/chat", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req) => {
    const input = bodySchema.parse(req.body);
    const result = await runHetznerChat(input.messages);
    return {
      message: {
        role: "assistant" as const,
        content: result.content,
      },
      model: result.model,
      capabilities: {
        actions: false,
        mailboxAccess: false,
        rewriteEmail: true,
      },
    };
  });
}
