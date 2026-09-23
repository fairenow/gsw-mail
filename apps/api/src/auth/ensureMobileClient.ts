import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { config } from "../config.js";
import { db } from "../db/client.js";
import { oauthClient } from "../db/schema.js";

const clientId = config.auth.mobileClientId;
const redirectUri = config.auth.mobileRedirectUri;

const existing = await db.select({ id: oauthClient.id }).from(oauthClient).where(eq(oauthClient.clientId, clientId)).limit(1);
const values = {
  redirectUris: [redirectUri],
  scopes: ["openid", "email"],
  name: "GSW Mail Mobile",
  grantTypes: ["authorization_code"],
  responseTypes: ["code"],
  skipConsent: true,
  requirePKCE: true,
  disabled: false,
  public: true,
  tokenEndpointAuthMethod: "none",
  type: "native",
};

if (existing[0]) {
  await db.update(oauthClient).set(values).where(eq(oauthClient.clientId, clientId));
  console.log(JSON.stringify({ action: "updated", clientId, redirectUri }));
} else {
  await db.insert(oauthClient).values({
    id: randomUUID(),
    clientId,
    clientSecret: null,
    ...values,
  });
  console.log(JSON.stringify({ action: "created", clientId, redirectUri }));
}
