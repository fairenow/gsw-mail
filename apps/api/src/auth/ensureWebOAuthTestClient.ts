import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { config } from "../config.js";
import { db } from "../db/client.js";
import { oauthClient } from "../db/schema.js";

export const WEB_OAUTH_TEST_CLIENT_ID = "gsw-mail-web-oauth-test";

export function webOAuthTestRedirectUri(): string {
  return `${config.auth.trustedOrigin.replace(/\/$/, "")}/oauth/test/callback`;
}

export async function ensureWebOAuthTestClient(): Promise<void> {
  const origin = config.auth.trustedOrigin.replace(/\/$/, "");
  const redirectUri = webOAuthTestRedirectUri();
  const values = {
    redirectUris: [redirectUri],
    scopes: ["openid", "profile", "email"],
    name: "GSW Mail",
    uri: `${origin}/#oauth`,
    grantTypes: ["authorization_code"],
    responseTypes: ["code"],
    skipConsent: false,
    requirePKCE: true,
    disabled: false,
    public: true,
    tokenEndpointAuthMethod: "none",
    type: "web",
  };

  const existing = await db.select({ id: oauthClient.id }).from(oauthClient).where(eq(oauthClient.clientId, WEB_OAUTH_TEST_CLIENT_ID)).limit(1);
  if (existing[0]) {
    await db.update(oauthClient).set(values).where(eq(oauthClient.clientId, WEB_OAUTH_TEST_CLIENT_ID));
    return;
  }

  await db.insert(oauthClient).values({
    id: randomUUID(),
    clientId: WEB_OAUTH_TEST_CLIENT_ID,
    clientSecret: null,
    ...values,
  });
}
