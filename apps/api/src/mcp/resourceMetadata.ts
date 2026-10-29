import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import { aiScopes } from "../ai/permissions/types.js";

export const mcpAdvertisedScopes = [...aiScopes];

// Never advertise a scope that the authorization server will reject.
const validOAuthScopes = new Set<string>(aiScopes);
for (const scope of mcpAdvertisedScopes) {
  if (!validOAuthScopes.has(scope)) throw new Error(`MCP advertises unsupported OAuth scope: ${scope}`);
}


/**
 * RFC 9728 protected resource metadata for the future /mcp resource.
 * OAuth metadata is public discovery information, not authorization.
 * Does not enable tools/call or expose a partially secured MCP endpoint.
 */
export async function mcpProtectedResourceMetadata(app:FastifyInstance):Promise<void> {
  const base=config.auth.baseUrl.replace(/\/$/,"");
  const resource=process.env.GSW_MCP_RESOURCE_URL ?? `${base}/mcp`;
  const metadata={
    resource,
    authorization_servers:[config.auth.issuer],
    bearer_methods_supported:["header"],
    scopes_supported:mcpAdvertisedScopes,
  };
  app.get("/.well-known/oauth-protected-resource/mcp",async (_request,reply)=>
    reply.header("cache-control","public, max-age=300").send(metadata));
  app.get("/.well-known/oauth-protected-resource",async (_request,reply)=>
    reply.header("cache-control","public, max-age=300").send(metadata));
}
