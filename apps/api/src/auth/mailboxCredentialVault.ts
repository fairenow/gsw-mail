import { createRemoteJWKSet } from "jose";
import { config } from "../config.js";
import { pool } from "../db/client.js";
import { firstPartyStalwartClientIds } from "./firstPartyClients.js";
import { decryptMailboxCredential, encryptMailboxCredential, oauthTokenHash } from "./mailboxCredentialCrypto.js";
import type { CredentialBinding } from "./mailboxCredentialCrypto.js";
import type { TrustedMailboxPrincipal } from "./trustedMailboxCredential.js";
import { verifyStalwartMailboxJwt } from "./verifyStalwartMailboxJwt.js";

const jwks = createRemoteJWKSet(new URL(`${config.auth.issuer}/jwks`));
type Query = Pick<typeof pool, "query">;
export async function persistMailboxCredential(input: TrustedMailboxPrincipal & { clientId: string; accessToken: string; refreshToken: string }, database: Query = pool, verifyToken = verifyStalwartMailboxJwt) {
  if (database === pool) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`mailbox-credential:${input.accountId}`]);
      await persistMailboxCredential(input, client, verifyToken);
      await client.query("COMMIT");
      return;
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }
  if (!firstPartyStalwartClientIds().includes(input.clientId)) throw new Error("mailbox credential client is not first party");
  const { rows } = await database.query<{ address: string }>(`SELECT a.address FROM email_accounts a
    JOIN users u ON u.id=a.user_id JOIN auth_users au ON au.id=u.auth_user_id
    JOIN mail_account_memberships m ON m.account_id=a.id AND m.user_id=u.id AND m.auth_user_id=au.id
    JOIN oauth_refresh_token r ON r.user_id=au.id AND r.client_id=$4 AND r.token=$5
    JOIN oauth_client c ON c.client_id=r.client_id
    WHERE a.id=$1 AND u.id=$2 AND au.id=$3 AND lower(a.address)=lower(au.email)
    AND a.account_status='active' AND a.auth_setup_status='ready' AND u.user_status='active' AND m.account_membership_role='owner'
    AND c.disabled=false AND r.revoked IS NULL AND r.expires_at>now() AND 'email'=ANY(r.scopes) AND 'offline_access'=ANY(r.scopes)
    LIMIT 1`, [input.accountId, input.productUserId, input.authUserId, input.clientId, oauthTokenHash(input.refreshToken)]);
  const address = rows[0]?.address;
  if (!address) throw new Error("mailbox refresh authorization is unavailable");
  await verifyToken(input.accessToken, input, jwks, { issuer: config.auth.issuer, audience: config.auth.stalwartAudience, mailboxAddress: address });
  const binding: CredentialBinding = input;
  await database.query(`INSERT INTO mailbox_credential_vault(account_id,auth_user_id,client_id,refresh_token_hash,encrypted_access_token,encrypted_refresh_token)
    VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(account_id) DO UPDATE SET
    auth_user_id=EXCLUDED.auth_user_id,client_id=EXCLUDED.client_id,refresh_token_hash=EXCLUDED.refresh_token_hash,
    encrypted_access_token=EXCLUDED.encrypted_access_token,encrypted_refresh_token=EXCLUDED.encrypted_refresh_token,updated_at=now()`,
    [input.accountId, input.authUserId, input.clientId, oauthTokenHash(input.refreshToken), encryptMailboxCredential(input.accessToken, binding, config.auth.secret), encryptMailboxCredential(input.refreshToken, binding, config.auth.secret)]);
}
export async function loadMailboxCredential(input: TrustedMailboxPrincipal, database: Query = pool) {
  const { rows } = await database.query<{ client_id: string; address: string; encrypted_access_token: string; encrypted_refresh_token: string }>(`SELECT v.client_id,a.address,v.encrypted_access_token,v.encrypted_refresh_token
    FROM mailbox_credential_vault v JOIN email_accounts a ON a.id=v.account_id
    JOIN users u ON u.id=a.user_id JOIN auth_users au ON au.id=u.auth_user_id
    JOIN mail_account_memberships m ON m.account_id=a.id AND m.user_id=u.id AND m.auth_user_id=au.id
    JOIN oauth_refresh_token r ON r.token=v.refresh_token_hash AND r.user_id=v.auth_user_id AND r.client_id=v.client_id
    JOIN oauth_client c ON c.client_id=r.client_id
    WHERE a.id=$1 AND u.id=$2 AND au.id=$3 AND v.auth_user_id=$3 AND lower(a.address)=lower(au.email)
    AND a.account_status='active' AND a.auth_setup_status='ready' AND u.user_status='active' AND m.account_membership_role='owner'
    AND c.disabled=false AND r.revoked IS NULL AND r.expires_at>now() AND 'email'=ANY(r.scopes) AND 'offline_access'=ANY(r.scopes)
    LIMIT 1`, [input.accountId, input.productUserId, input.authUserId]);
  const row = rows[0];
  if (!row || !firstPartyStalwartClientIds().includes(row.client_id)) return null;
  const binding = { ...input, clientId: row.client_id };
  return { clientId: row.client_id, address: row.address, accessToken: decryptMailboxCredential(row.encrypted_access_token, binding, config.auth.secret), refreshToken: decryptMailboxCredential(row.encrypted_refresh_token, binding, config.auth.secret) };
}
