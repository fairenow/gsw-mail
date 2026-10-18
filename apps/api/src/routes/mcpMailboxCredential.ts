import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { config } from "../config.js";
import { requireUser } from "../auth/middleware.js";
import { establishBrokerMailboxCredential } from "../auth/brokerMailboxCredential.js";

/**
 * First-party GSW product session route, deliberately separate from /mcp.
 * It establishes a refreshable mailbox credential while the signed-in user is
 * present (for example when connecting an MCP client), which a later
 * sessionless MCP request can renew. An MCP resource token cannot authenticate
 * here and is never converted into a mailbox credential.
 */
export default async function mcpMailboxCredentialRoutes(app: FastifyInstance) {
  await requireUser(app, { optional: false });

  app.post("/product/mcp/mailbox-credential", async (req, reply) => {
    if (!req.headers.cookie || req.headers.authorization) {
      return reply.code(403).send({ error: "first_party_session_required" });
    }
    const origin = req.headers.origin;
    const trustedOrigins = [config.auth.baseUrl, ...config.auth.trustedOrigin.split(",")]
      .map(value => value.trim()).filter(Boolean);
    if (origin && !trustedOrigins.some(value => {
      try { return new URL(value).origin === new URL(origin).origin; }
      catch { return false; }
    })) return reply.code(403).send({ error: "untrusted_origin" });
    if (!origin) return reply.code(403).send({ error: "origin_required" });
    if (!req.authUserId) return reply.code(403).send({ error: "auth_identity_required" });

    const body = z.object({ accountId: z.string().uuid() }).parse(req.body);
    const result = await establishBrokerMailboxCredential({
      productUserId: req.user!.id,
      authUserId: req.authUserId,
      accountId: body.accountId,
      headers: req.headers as Record<string, string>,
    });
    if (!result.established) return reply.code(409).send({ error: result.reason ?? "mailbox_credential_not_established" });
    return { established: true };
  });
}
