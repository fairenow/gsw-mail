import { eq } from "drizzle-orm";
import { config } from "../config.js";
import { db } from "../db/client.js";
import { oauthClient } from "../db/schema.js";

/**
 * Keep the configured first-party confidential Stalwart broker renewable
 * after deploys and restores. Never modify arbitrary OAuth clients, and never
 * convert a public/mobile or external MCP client into a confidential broker.
 *
 * This updates allowed grant metadata only. It cannot recreate a revoked
 * user authorization or bypass the browser-based account recovery flow.
 */
export async function ensureRenewableStalwartBrokerClient(): Promise<"updated" | "ready" | "unconfigured" | "invalid"> {
  const clientId = config.auth.oauthClientId;
  if (!clientId || !config.auth.oauthClientSecret || clientId === config.auth.mobileClientId) {
    return "unconfigured";
  }
  const [client] = await db.select({
    id: oauthClient.id,
    name: oauthClient.name,
    grantTypes: oauthClient.grantTypes,
    scopes: oauthClient.scopes,
    public: oauthClient.public,
    disabled: oauthClient.disabled,
    tokenEndpointAuthMethod: oauthClient.tokenEndpointAuthMethod,
  }).from(oauthClient).where(eq(oauthClient.clientId, clientId)).limit(1);

  if (!client || client.name !== "GSW Stalwart Mail Access"
    || client.disabled || client.public
    || client.tokenEndpointAuthMethod !== "client_secret_basic"
    || !client.grantTypes.includes("authorization_code")
    || !client.scopes.includes("openid") || !client.scopes.includes("email")) {
    return "invalid";
  }

  const grantTypes = [...new Set([...client.grantTypes, "refresh_token"])];
  const scopes = [...new Set([...client.scopes, "offline_access"])];
  if (grantTypes.length === client.grantTypes.length && scopes.length === client.scopes.length) return "ready";

  await db.update(oauthClient).set({ grantTypes, scopes }).where(eq(oauthClient.id, client.id));
  return "updated";
}
