import { config } from "../config.js";
import { pool } from "../db/client.js";
import { loadMailboxCredential, persistMailboxCredential } from "./mailboxCredentialVault.js";
import type { TrustedMailboxPrincipal } from "./trustedMailboxCredential.js";

export async function refreshStoredStalwartMailboxToken(input: TrustedMailboxPrincipal & { request?: typeof fetch }): Promise<string | null> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`mailbox-credential:${input.accountId}`]);
    const credential = await loadMailboxCredential(input, client);
    if (!credential) { await client.query("COMMIT"); return null; }
    const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: credential.refreshToken, client_id: credential.clientId, resource: config.auth.stalwartAudience });
    const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded" };
    if (credential.clientId === config.auth.oauthClientId && config.auth.oauthClientSecret) headers.authorization = `Basic ${Buffer.from(`${credential.clientId}:${config.auth.oauthClientSecret}`, "utf8").toString("base64")}`;
    const response = await (input.request ?? fetch)(`${config.auth.issuer}/oauth2/token`, { method: "POST", headers, body, signal: AbortSignal.timeout(10000) });
    if (!response.ok) {
      console.warn("[mailbox-credential] refresh rejected", { status: response.status });
      await client.query("COMMIT");
      return null;
    }
    const tokens = await response.json() as { access_token?: string; refresh_token?: string };
    if (!tokens.access_token || !tokens.refresh_token) throw new Error("mailbox refresh returned incomplete credentials");
    await persistMailboxCredential({ ...input, clientId: credential.clientId, accessToken: tokens.access_token, refreshToken: tokens.refresh_token }, client);
    await client.query("COMMIT");
    return tokens.access_token;
  } catch {
    await client.query("ROLLBACK");
    console.warn("[mailbox-credential] refresh unavailable");
    return null;
  } finally { client.release(); }
}
