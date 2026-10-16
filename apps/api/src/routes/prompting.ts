import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { config } from "../config.js";
import { pool } from "../db/client.js";
import { createHmac } from "node:crypto";

/**
 * Separate, feature-flagged inference endpoint for the account-free Prompting app.
 * Never register GSW mailbox tools or borrow mailbox authorization here.
 * Database quota is atomic across Railway instances; this is an anonymous, IP-based fair-use limit.
 */
const message = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.string().min(1).max(8000),
});
const body = z.object({
  messages: z.array(message).min(1).max(12),
  temperature: z.number().min(0).max(1).optional(),
  max_tokens: z.number().int().min(1).max(1200).optional(),
}).strict();

export default async function prompting(app: FastifyInstance) {
  app.post("/api/prompting/chat", {
    config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
    bodyLimit: 40000,
  }, async (req, reply) => {
    if (process.env.PROMPTING_ANONYMOUS_INFERENCE_ENABLED !== "true") {
      return reply.code(503).send({ error: "prompting_inference_not_enabled" });
    }
    const input = body.safeParse(req.body);
    if (!input.success) return reply.code(400).send({ error: "invalid_prompt" });
    if (!config.ai.hetznerApiKey) return reply.code(503).send({ error: "inference_unavailable" });
    // Server-observed address only. Never trust a client-supplied X-Forwarded-For.
    // This can group multiple users behind NAT; production proxy IP handling needs verification.
    const identity = createHmac("sha256", config.auth.secret).update(req.ip).digest("hex");
    const hour = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000);
    try {
      const result = await pool.query(`
        INSERT INTO prompting_hourly_quota (identity_hash, hour_start, used)
        VALUES ($1, $2, 1)
        ON CONFLICT (identity_hash, hour_start)
        DO UPDATE SET used = prompting_hourly_quota.used + 1
        WHERE prompting_hourly_quota.used < 30
        RETURNING used
      `, [identity, hour]);
      if (!result.rowCount) {
        const retryAfter = Math.max(1, Math.ceil((hour.getTime() + 3_600_000 - Date.now()) / 1000));
        return reply.code(429).header("Retry-After", String(retryAfter))
          .send({ error: "hourly_limit_reached", limit: 30, retryAfterSeconds: retryAfter });
      }
    } catch (error) {
      req.log.error({ error }, "Prompting quota check unavailable");
      return reply.code(503).send({ error: "quota_unavailable" });
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const upstream = await fetch(`${config.ai.hetznerBaseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${config.ai.hetznerApiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: config.ai.hetznerModel,
          messages: input.data.messages,
          temperature: input.data.temperature ?? 0.35,
          max_tokens: input.data.max_tokens ?? 750,
          stream: false,
        }),
        signal: controller.signal,
      });
      if (!upstream.ok) return reply.code(502).send({ error: "inference_unavailable" });
      const data = await upstream.json() as { choices?: Array<{ message?: { content?: string } }> };
      const content = data.choices?.[0]?.message?.content;
      if (typeof content !== "string") return reply.code(502).send({ error: "invalid_inference_response" });
      return { choices: [{ message: { role: "assistant", content } }] };
    } catch {
      return reply.code(503).send({ error: "inference_unavailable" });
    } finally {
      clearTimeout(timeout);
    }
  });
}
