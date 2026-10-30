import integrationApi from "./routes/integrationApi.js";
import integrationAdmin from "./routes/integrationAdmin.js";
import mcpAccessProfile from "./routes/mcpAccessProfile.js";
import { resolveMcpAccessProfile, scopeAllowedForMode } from "./mcp/accessProfile.js";
import { fromNodeHeaders } from "better-auth/node";
import { db } from "./db/client.js";
import { users } from "./db/schema.js";
import { eq } from "drizzle-orm";
import adminDeletion from "./routes/adminDeletion.js";
import cors from "@fastify/cors";
import formbody from "@fastify/formbody";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import { ZodError } from "zod";
import { requireUser } from "./auth/middleware.js";
import { HttpError } from "./lib/errors.js";
import accounts from "./routes/accounts.js";
import admin from "./routes/admin.js";
import aliases from "./routes/aliases.js";
import attachments from "./routes/attachments.js";
import drafts from "./routes/drafts.js";
import folders from "./routes/folders.js";
import messages from "./routes/messages.js";
import mailActions from "./routes/mailActions.js";
import search from "./routes/search.js";
import send from "./routes/send.js";
import sends from "./routes/sends.js";
import suppressions from "./routes/suppressions.js";
import threads from "./routes/threads.js";
import webhooks from "./routes/webhooks.js";
import stalwartWebhooks from "./routes/stalwartWebhooks.js";
import product from "./routes/product.js";
import calendarSync from "./routes/calendarSync.js";
import calendarRsvp from "./routes/calendarRsvp.js";
import calendarRsvpPublic from "./routes/calendarRsvpPublic.js";
import aiChat from "./routes/aiChat.js";
import aiAutomations from "./routes/aiAutomations.js";
import mcpApprovals from "./routes/mcpApprovals.js";
import mcpMailboxCredential from "./routes/mcpMailboxCredential.js";
import prompting from "./routes/prompting.js";
import contactSuggestions from "./routes/contactSuggestions.js";
import templates from "./routes/templates.js";
import templateAssetsPublic from "./routes/templateAssetsPublic.js";
import { avatarLookup, publicAvatars } from "./routes/publicAvatars.js";
import setup from "./routes/setup.js";
import account from "./routes/account.js";
import connectedApps from "./routes/connectedApps.js";
import accountPassword from "./routes/accountPassword.js";
import mailboxSetup from "./routes/mailboxSetup.js";
import recovery from "./routes/recovery.js";
import pushDevices from "./routes/pushDevices.js";
import mailChanges from "./routes/mailChanges.js";
import domainAdmin from "./routes/domainAdmin.js";
import files from "./routes/files.js";
import fileSharing from "./routes/fileSharing.js";
import analytics from "./routes/analytics.js";
import { auth as betterAuth } from "./auth/better.js";
import { firstPartyStalwartClientIds } from "./auth/firstPartyClients.js";
import { requireFreshExternalMcpConsent } from "./auth/mcpOAuthConsentPrompt.js";
import { oauthProviderAuthServerMetadata, oauthProviderOpenIdConfigMetadata } from "@better-auth/oauth-provider";
import { config } from "./config.js";
import { JmapError } from "./engine/jmap.js";
import { mcpProtectedResourceMetadata } from "./mcp/resourceMetadata.js";
import { mcpRoutes } from "./mcp/routes.js";

const MAIL_ATTACHMENT_BODY_LIMIT = 30 * 1024 * 1024;

export function buildApp() {
  const app = Fastify({ logger: true, bodyLimit: MAIL_ATTACHMENT_BODY_LIMIT });

  app.register(cors, { origin: true });
  app.register(rateLimit, { max: 120, timeWindow: "1 minute" });
  app.register(formbody);
  app.register(mcpProtectedResourceMetadata);
  app.register(mcpRoutes);
  app.register(mcpAccessProfile);
  const metadataResponse = async (handler: (request: Request) => Promise<Response>, req: { url: string; headers: Record<string, string | string[] | undefined> }, reply: { code: (status: number) => { header: (name: string, value: string) => unknown; send: (body: Buffer) => unknown } }) => {
    const response = await handler(new Request(`${config.auth.baseUrl}${req.url}`, { headers: req.headers as Record<string, string> }));
    const target = reply.code(response.status);
    response.headers.forEach((value, key) => target.header(key, value));
    return target.send(Buffer.from(await response.arrayBuffer()));
  };
  app.get("/api/auth/.well-known/openid-configuration", async (req, reply) => metadataResponse(oauthProviderOpenIdConfigMetadata(betterAuth), req, reply));
  app.get("/api/auth/.well-known/oauth-authorization-server", async (req, reply) => metadataResponse(oauthProviderAuthServerMetadata(betterAuth), req, reply));
  app.all("/api/auth/*", async (req, reply) => {
    if (req.method === "POST" && req.url.split("?")[0] === "/api/auth/oauth2/consent" && [true, "true"].includes((req.body as {accept?:boolean|string})?.accept ?? false)) {
      const consent = req.body as {scope?:string};
      if (typeof consent.scope !== "string" || !consent.scope.trim()) return reply.code(400).send({error:"explicit_consent_scopes_required"});
      const session = await betterAuth.api.getSession({headers:fromNodeHeaders(req.headers),query:{disableCookieCache:true}});
      if (!session) return reply.code(401).send({error:"session_required"});
      const [user] = await db.select({id:users.id}).from(users).where(eq(users.authUserId,session.user.id)).limit(1);
      if (!user) return reply.code(403).send({error:"account_not_linked"});
      const profile = await resolveMcpAccessProfile(user.id,session.user.id);
      if (consent.scope.trim().split(/\s+/).some(scope => !scopeAllowedForMode(profile.mode,scope))) return reply.code(403).send({error:"scope_not_allowed_for_account_type",accountType:profile.mode});
    }
    const body = betterAuthBody(req);
    const authorizeUrl = req.method === "GET"
      ? requireFreshExternalMcpConsent(`${config.auth.baseUrl}${req.url}`, new Set(firstPartyStalwartClientIds()))
      : `${config.auth.baseUrl}${req.url}`;
    const request = new Request(authorizeUrl, {
      method: req.method,
      headers: req.headers as Record<string, string>,
      ...(body !== undefined ? { body } : {}),
    });
    const response = await betterAuth.handler(request);
    reply.code(response.status);
    response.headers.forEach((value, key) => reply.header(key, value));
    return reply.send(Buffer.from(await response.arrayBuffer()));
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof HttpError) {
      return reply.code(error.status).send({ error: error.message });
    }
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: "invalid request", issues: error.issues });
    }
    if (error instanceof JmapError && error.type === "mail_identity_rejected") {
      return reply.code(401).send({ error: "mail_identity_rejected" });
    }
    const mailboxReconnectErrors = new Set(["mailbox_session_required", "mailbox_session_identity_mismatch", "oauth_interaction_required"]);
    if (error instanceof Error && mailboxReconnectErrors.has(error.message)) {
      request.log.warn({ reason: error.message, path: request.url.split("?")[0] }, "mailbox authorization requires attention");
      return reply.code(401).send({ error: "mailbox_reconnect_required", message: "Your mailbox connection needs attention. Sign out and sign in again to reconnect." });
    }
    if ((error as { code?: string }).code === "FST_ERR_CTP_INVALID_MEDIA_TYPE") {
      // Record request metadata only; never log OAuth credentials or MCP payloads.
      app.log.warn({ method: request.method, path: request.url.split("?")[0], contentType: request.headers["content-type"] ?? "(missing)", accept: request.headers.accept ?? "(missing)" }, "unsupported content type");
      return reply.code(415).send({ error: "unsupported media type" });
    }
    // Keep rate limiting distinguishable from unexpected server failures.
    // Do not expose underlying request details or credentials.
    if (typeof error === "object" && error !== null && "statusCode" in error && error.statusCode === 429) {
      return reply.code(429).send({ error: "rate_limit_exceeded", retryable: true });
    }
    request.log.error({ err: error, method: request.method, path: request.url.split("?")[0] }, "request failed");
    return reply.code(500).send({ error: "internal server error" });
  });

  app.register(requireUser, { optional: true }).register(async (anon) => {
    anon.get("/health", async () => ({ ok: true, service: "gsw-mail-api" }));
  });

  app.register(integrationApi);
  app.register(integrationAdmin);
  app.register(accounts);
  app.register(aliases);
  app.register(messages);
  app.register(folders);
  app.register(attachments);
  app.register(mailActions);
  app.register(threads);
  app.register(search);
  app.register(send);
  app.register(sends);
  app.register(drafts);
  app.register(adminDeletion);
  app.register(admin);
  app.register(domainAdmin);
  app.register(files);
  app.register(fileSharing);
  app.register(analytics);
  app.register(suppressions);
  app.register(webhooks);
  app.register(stalwartWebhooks);
  app.register(product);
  app.register(templateAssetsPublic);
  app.register(publicAvatars);
  app.register(avatarLookup);
  app.register(calendarRsvpPublic);
  app.register(calendarRsvp);
  app.register(aiChat);
  app.register(aiAutomations);
  app.register(mcpApprovals);
  app.register(mcpMailboxCredential);
  app.register(prompting);
  app.register(calendarSync);
  app.register(contactSuggestions);
  app.register(templates);
  app.register(setup);
  app.register(account);
  app.register(connectedApps);
  app.register(accountPassword);
  app.register(mailboxSetup);
  app.register(recovery);
  app.register(pushDevices);
  app.register(mailChanges);

  return app;
}

function betterAuthBody(req: { method: string; headers: Record<string, string | string[] | undefined>; body?: unknown }): string | undefined {
  if (req.method === "GET" || req.method === "HEAD") return undefined;
  const contentType = String(req.headers["content-type"] ?? "").split(";", 1)[0]!.trim().toLowerCase();
  if (contentType === "application/x-www-form-urlencoded") {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries((req.body ?? {}) as Record<string, unknown>)) {
      if (value == null) continue;
      if (Array.isArray(value)) {
        for (const item of value) params.append(key, String(item));
      } else {
        params.set(key, String(value));
      }
    }
    return params.toString();
  }
  if (contentType === "application/json" || contentType === "") return JSON.stringify(req.body ?? {});
  if (typeof req.body === "string") return req.body;
  const error = new Error(`unsupported Better Auth content type: ${contentType || "missing"}`) as Error & { code?: string; statusCode?: number };
  error.code = "FST_ERR_CTP_INVALID_MEDIA_TYPE";
  error.statusCode = 415;
  throw error;
}
