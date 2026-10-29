import { adminToolRisk } from "../mcp/adminTools.js";
import type { FastifyInstance } from "fastify";
import { requireUser } from "../auth/middleware.js";
import { resolveMcpAccessProfile, scopeAllowedForMode, adminScopes } from "../mcp/accessProfile.js";
import { permissionDescriptions } from "../mcp/permissionDescriptions.js";
import { mcpBootstrapTools } from "../mcp/bootstrapTools.js";
import { agentMailRegistry } from "../ai/tools/registry.js";
export default async function mcpAccessProfile(app: FastifyInstance) {
  await requireUser(app, {optional:false});
  app.get("/product/mcp/access-profile", async (req, reply) => {
    reply.header("cache-control", "private, no-store");
    const profile = await resolveMcpAccessProfile(req.user!.id, req.authUserId ?? "");
    const tools = profile.mode === "admin" ? mcpBootstrapTools.filter(tool => tool.name.includes("admin_")) : profile.mode === "mailbox" ? agentMailRegistry.definitions().filter(tool => tool.requiredScopes.every(scope => scopeAllowedForMode("mailbox", scope))) : [];
    return {...profile, permissions: Object.entries(permissionDescriptions).map(([scope, description]) => ({scope,description,group:adminScopes.has(scope) ? "admin" : "mailbox",allowed:scopeAllowedForMode(profile.mode,scope),tools:tools.filter(tool => tool.requiredScopes.includes(scope as never)).map(tool => ({name:tool.name,description:tool.name.startsWith("workers.") ? "Read-only helpers limited to this mailbox connection’s permissions. Administration is excluded." : tool.description,requiredScopes:[...tool.requiredScopes],risk:"risk" in tool ? tool.risk : adminToolRisk(tool.name)}))}))};
  });
}
