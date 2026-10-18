import { and, desc, eq, gt, inArray, isNull, or } from "drizzle-orm";
import { createRemoteJWKSet } from "jose";
import { db } from "../db/client.js";
import { oauthAccessToken, oauthClient, oauthRefreshToken, emailAccounts } from "../db/schema.js";
import { config } from "../config.js";
import { verifyStalwartMailboxJwt } from "./verifyStalwartMailboxJwt.js";
import { selectVerifiedStoredToken } from "./selectStoredStalwartToken.js";
import { firstPartyStalwartClientIds } from "./firstPartyClients.js";

/**
 * Reuse only an existing, persisted, signed first-party mailbox credential.
 * No token minting, bearer substitution, or privileged token exchange occurs.
 * Caller MUST have already passed account authorization and identity linkage.
 */
const jwks = createRemoteJWKSet(new URL(`${config.auth.issuer}/jwks`));

export async function findStoredStalwartMailboxToken(input: {
  productUserId: string;
  authUserId: string;
  accountId: string;
}): Promise<string | null> {
  const [account] = await db.select({
    address: emailAccounts.address,
    status: emailAccounts.status,
    authSetupStatus: emailAccounts.authSetupStatus,
  }).from(emailAccounts).where(eq(emailAccounts.id, input.accountId)).limit(1);
  if (!account || account.status !== "active" || account.authSetupStatus !== "ready") return null;

  const candidates = await db.select({
    token: oauthAccessToken.token,
    scopes: oauthAccessToken.scopes,
  }).from(oauthAccessToken)
    .innerJoin(oauthClient, eq(oauthAccessToken.clientId, oauthClient.clientId))
    .leftJoin(oauthRefreshToken, eq(oauthAccessToken.refreshId, oauthRefreshToken.id))
    .where(and(
    eq(oauthClient.disabled, false),
    or(isNull(oauthAccessToken.refreshId), and(isNull(oauthRefreshToken.revoked), gt(oauthRefreshToken.expiresAt, new Date()))),
    eq(oauthAccessToken.userId, input.authUserId),
    inArray(oauthAccessToken.clientId, firstPartyStalwartClientIds()),
    gt(oauthAccessToken.expiresAt, new Date(Date.now() + 60_000)),
  )).orderBy(desc(oauthAccessToken.expiresAt)).limit(5);

  return selectVerifiedStoredToken(candidates, async (token) => {
    await verifyStalwartMailboxJwt(token,
      { productUserId: input.productUserId, authUserId: input.authUserId, accountId: input.accountId },
      jwks,
      { issuer: config.auth.issuer, audience: config.auth.stalwartAudience, mailboxAddress: account.address },
    );
  });
}
