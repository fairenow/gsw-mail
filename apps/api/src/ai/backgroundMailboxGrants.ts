import { pool } from "../db/client.js";

// A grant is never inferred from an interactive mail.read permission.
// Offline mailbox work requires a separate, revocable, user-scoped grant AND
// a separately provisioned credential reference. This module does not create
// credentials, grant permissions or enable background mailbox operations.
export async function ensureBackgroundMailboxGrantSchema() {
  await pool.query(`CREATE TABLE IF NOT EXISTS ai_background_mail_grants (
    id uuid PRIMARY KEY,
    user_id text NOT NULL,
    account_id uuid NOT NULL,
    scope text NOT NULL CHECK (scope IN ('mail.read','mail.draft')),
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','revoked')),
    credential_ref text,
    expires_at timestamptz,
    revoked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id,account_id,scope)
  );
  CREATE INDEX IF NOT EXISTS ai_background_mail_grants_active_idx
    ON ai_background_mail_grants (user_id,account_id,scope)
    WHERE status='active';`);
}

/** Fail closed: a pending grant, missing credential or expired grant denies access. */
export async function requireBackgroundMailboxGrant(input:{
  userId:string; accountId:string; scope:"mail.read"|"mail.draft";
}):Promise<{credentialRef:string}> {
  const {rows}=await pool.query<{credential_ref:string}>(
    `SELECT credential_ref FROM ai_background_mail_grants
     WHERE user_id=$1 AND account_id=$2 AND scope=$3
       AND status='active' AND credential_ref IS NOT NULL
       AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>now())
     LIMIT 1`,[input.userId,input.accountId,input.scope]);
  const credentialRef=rows[0]?.credential_ref;
  if(!credentialRef) throw new Error("Background mailbox authorization is not available");
  return {credentialRef};
}

/** Revocation makes subsequent worker checkpoints fail authorization. */
export async function revokeBackgroundMailboxGrant(input:{
  userId:string;accountId:string;scope:"mail.read"|"mail.draft";
}) {
  await pool.query(
    `UPDATE ai_background_mail_grants SET status='revoked',credential_ref=NULL,
     revoked_at=now(),updated_at=now()
     WHERE user_id=$1 AND account_id=$2 AND scope=$3`,
    [input.userId,input.accountId,input.scope]);
}

export type BackgroundMailboxScope = "mail.read" | "mail.draft";

/** Explicit consent starts as pending; it cannot activate access or issue credentials. */
export async function requestBackgroundMailboxGrant(input:{
  userId:string; accountId:string; scope:BackgroundMailboxScope; expiresAt:Date;
}) {
  const {rows}=await pool.query<{id:string;status:string;expires_at:Date|null}>(
    `INSERT INTO ai_background_mail_grants
       (id,user_id,account_id,scope,status,credential_ref,expires_at,revoked_at)
     VALUES(gen_random_uuid(),$1,$2,$3,'pending',NULL,$4,NULL)
     ON CONFLICT(user_id,account_id,scope) DO UPDATE
     SET status='pending',credential_ref=NULL,expires_at=EXCLUDED.expires_at,
         revoked_at=NULL,updated_at=now()
     RETURNING id,status,expires_at`,
    [input.userId,input.accountId,input.scope,input.expiresAt],
  );
  return rows[0]!;
}

export async function listBackgroundMailboxGrants(userId:string,accountId:string){
  const {rows}=await pool.query<{
    id:string;scope:BackgroundMailboxScope;status:string;expires_at:Date|null;
    credential_configured:boolean;
  }>(`SELECT id,scope,status,expires_at,
       (credential_ref IS NOT NULL) AS credential_configured
     FROM ai_background_mail_grants
     WHERE user_id=$1 AND account_id=$2 ORDER BY scope`,[userId,accountId]);
  return rows;
}
