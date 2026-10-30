import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { decryptMailboxCredential, encryptMailboxCredential, oauthTokenHash } from "./mailboxCredentialCrypto.js";

const secret = "unit-test-mailbox-encryption-secret-0000000000000000";
process.env.BETTER_AUTH_SECRET = secret;

test("mailbox credential encryption rejects tampering and cross-mailbox decryption", () => {
  const binding = { accountId: randomUUID(), authUserId: "owner", clientId: "gsw-mail-mobile" };
  const sealed = encryptMailboxCredential("raw-secret", binding, secret);
  assert.ok(!sealed.includes("raw-secret"));
  assert.equal(decryptMailboxCredential(sealed, binding, secret), "raw-secret");
  assert.throws(() => decryptMailboxCredential(sealed, { ...binding, accountId: randomUUID() }, secret));
  assert.throws(() => decryptMailboxCredential(sealed, { ...binding, authUserId: "other" }, secret));
  assert.throws(() => decryptMailboxCredential(sealed.slice(0, -3) + "abc", binding, secret));
  assert.throws(() => decryptMailboxCredential(sealed, binding, secret + "wrong"));
  assert.equal(oauthTokenHash("abc"), "ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0");
});

test("credential vault requires an existing owner-bound offline grant and immediately respects revocation", async () => {
  const { persistMailboxCredential, loadMailboxCredential } = await import("./mailboxCredentialVault.js");
  const pg = new PGlite();
  try {
    for (const migration of ["0000_quick_falcon", "0001_add_template_key", "0006_better_auth", "0007_workspace_normalization", "0009_mailbox_auth_setup", "0012_better_auth_oauth", "0042_mailbox_credential_vault"]) await pg.exec(await readFile(new URL(`../../drizzle/${migration}.sql`, import.meta.url), "utf8"));
    await pg.exec(await readFile(new URL("../../drizzle/0042_mailbox_credential_vault.sql", import.meta.url), "utf8"));
    const organizationId = randomUUID(), domainId = randomUUID(), accountId = randomUUID();
    await pg.query("INSERT INTO auth_users(id,name,email,email_verified,created_at,updated_at) VALUES('auth-owner','Owner','owner@example.test',true,now(),now())");
    await pg.query("INSERT INTO users(id,identity_subject,email,auth_user_id) VALUES('owner','owner','owner@example.test','auth-owner')");
    await pg.query("INSERT INTO organizations(id,name,slug) VALUES($1,'Test','vault-test')", [organizationId]);
    await pg.query("INSERT INTO domains(id,organization_id,name,domain_status) VALUES($1,$2,'example.test','verified')", [domainId, organizationId]);
    await pg.query("INSERT INTO email_accounts(id,user_id,workspace_id,domain_id,local_part,address,account_status,auth_setup_status) VALUES($1,'owner',$2,$3,'owner','owner@example.test','active','ready')", [accountId, organizationId, domainId]);
    await pg.query("INSERT INTO mail_account_memberships(account_id,user_id,auth_user_id,account_membership_role) VALUES($1,'owner','auth-owner','owner')", [accountId]);
    await pg.query("INSERT INTO oauth_client(id,client_id,redirect_uris,disabled) VALUES('client','gsw-mail-mobile','{gswmail://oauth}',false)");
    await pg.query("INSERT INTO oauth_refresh_token(id,token,client_id,user_id,expires_at,created_at,scopes) VALUES('grant',$1,'gsw-mail-mobile','auth-owner',now()+interval '1 day',now(),'{email,offline_access}')", [oauthTokenHash("raw-refresh")]);
    const database = { query: (sql: string, parameters: unknown[]) => pg.query(sql, parameters) } as unknown as Parameters<typeof persistMailboxCredential>[1];
    const input = { accountId, productUserId: "owner", authUserId: "auth-owner", clientId: "gsw-mail-mobile", accessToken: "signed-access", refreshToken: "raw-refresh" };
    let verified = false;
    await persistMailboxCredential(input, database, async (_token, principal) => { assert.equal(principal.accountId, accountId); verified = true; });
    assert.equal(verified, true);
    const stored = await pg.query<{encrypted_access_token:string;encrypted_refresh_token:string}>("SELECT encrypted_access_token,encrypted_refresh_token FROM mailbox_credential_vault");
    assert.ok(!JSON.stringify(stored.rows).includes("signed-access"));
    assert.ok(!JSON.stringify(stored.rows).includes("raw-refresh"));
    assert.equal((await loadMailboxCredential(input, database))?.refreshToken, "raw-refresh");
    assert.equal(await loadMailboxCredential({ ...input, authUserId: "other" }, database), null);
    assert.equal(await loadMailboxCredential({ ...input, accountId: randomUUID() }, database), null);
    await assert.rejects(persistMailboxCredential({ ...input, refreshToken: oauthTokenHash("raw-refresh") }, database, async () => {}));
    await assert.rejects(persistMailboxCredential(input, database, async () => { throw new Error("JWT mismatch"); }));
    await pg.query("UPDATE oauth_client SET disabled=true");
    assert.equal(await loadMailboxCredential(input, database), null);
    await pg.query("UPDATE oauth_client SET disabled=false");
    await pg.query("UPDATE oauth_refresh_token SET revoked=now()");
    assert.equal(await loadMailboxCredential(input, database), null);
    await pg.query("UPDATE oauth_refresh_token SET revoked=NULL,expires_at=now()-interval '1 hour'");
    assert.equal(await loadMailboxCredential(input, database), null);
  } finally { await pg.close(); }
});
