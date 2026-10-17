import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { config } from "../config.js";
import { requireUser } from "../auth/middleware.js";
import { decideMcpApproval, listMcpApprovals } from "../mcp/approvalStore.js";

/**
 * First-party GSW product session routes, deliberately separate from /mcp.
 * MCP resource tokens cannot authenticate here as first-party sessions.
 * These endpoints only review and decide existing requests; they never execute.
 */
export default async function mcpApprovalsRoutes(app: FastifyInstance) {
  await requireUser(app, { optional: false });

  app.get("/product/mcp/approvals", async (req) => {
    const query = z.object({ limit: z.coerce.number().int().min(1).max(100).optional() }).parse(req.query);
    return { approvals: await listMcpApprovals(req.user!.id, query.limit ?? 30) };
  });

  app.post("/product/mcp/approvals/:id/decision", async (req, reply) => {
    // Browser session approval must originate from a trusted GSW UI, not a
    // cross-site form or a third-party MCP OAuth client.
    const origin = req.headers.origin;
    const trustedOrigins = [config.auth.baseUrl, ...config.auth.trustedOrigin.split(",")]
      .map(value => value.trim()).filter(Boolean);
    if (origin && !trustedOrigins.some(value => {
      try { return new URL(value).origin === new URL(origin).origin; }
      catch { return false; }
    })) return reply.code(403).send({ error: "untrusted_origin" });
    if (!origin && req.headers.cookie) return reply.code(403).send({ error: "origin_required" });
    const params = z.object({ id: z.string().uuid() }).parse(req.params);
    const input = z.object({ decision: z.enum(["approved", "rejected"]) }).parse(req.body);
    const approval = await decideMcpApproval({
      userId: req.user!.id,
      approvalId: params.id,
      decision: input.decision,
    });
    if (!approval) return reply.code(404).send({ error: "approval_not_found_or_not_pending" });
    return { approval };
  });
}
