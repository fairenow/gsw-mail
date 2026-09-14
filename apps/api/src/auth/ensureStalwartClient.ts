import { auth } from "./better.js";
import { config } from "../config.js";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { oauthClient } from "../db/schema.js";

const clientId = config.auth.oauthClientId;
if (!clientId) throw new Error("BETTER_AUTH_STALWART_CLIENT_ID is required");

const existing = await db.select({ id: oauthClient.id }).from(oauthClient).where(eq(oauthClient.clientId, clientId)).limit(1);
if (existing[0]) {
    await db.update(oauthClient).set({
      redirectUris: [config.auth.oauthRedirectUri],
      scopes: ["openid", "email"],
      name: "GSW Stalwart Mail Access",
      grantTypes: ["authorization_code"],
      responseTypes: ["code"],
      skipConsent: true,
      requirePKCE: true,
      disabled: false,
      tokenEndpointAuthMethod: "client_secret_basic",
    }).where(eq(oauthClient.clientId, clientId));
    console.log(JSON.stringify({ action: "updated", clientId, redirectUri: config.auth.oauthRedirectUri }));
} else {
  const result = await auth.api.adminCreateOAuthClient({
    body: {
      redirect_uris: [config.auth.oauthRedirectUri],
      scope: "openid email",
      client_name: "GSW Stalwart Mail Access",
      token_endpoint_auth_method: "client_secret_basic",
      grant_types: ["authorization_code"],
      response_types: ["code"],
      skip_consent: true,
      require_pkce: true,
    },
  });
    console.log(JSON.stringify({ action: "created", clientId: result.client_id, clientSecret: result.client_secret }));
}
