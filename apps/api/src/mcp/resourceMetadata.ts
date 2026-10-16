import type { FastifyInstance } from "fastify";
import { config } from "../config.js";

/**
 * RFC 9728 protected resource metadata for the future /mcp resource.
 * OAuth metadata is public discovery information, not authorization.
 * Does not enable tools/call or expose a partially secured MCP endpoint.
 */
export async function mcpProtectedResourceMetadata(app:FastifyInstance):Promise<void> {
  const base=config.auth.baseUrl.replace(/\/$/,"");
  const resource=`${base}/mcp`;
  const metadata={
    resource,
    authorization_servers:[config.auth.issuer],
    bearer_methods_supported:["header"],
    scopes_supported:["mail.read","mail.write","mail.send","contacts.read","contacts.write","calendar.read","calendar.write","files.read","files.write","automation.read","automation.write"],
  };
  app.get("/.well-known/oauth-protected-resource/mcp",async (_request,reply)=>
    reply.header("cache-control","public, max-age=300").send(metadata));
  app.get("/.well-known/oauth-protected-resource",async (_request,reply)=>
    reply.header("cache-control","public, max-age=300").send(metadata));
}
