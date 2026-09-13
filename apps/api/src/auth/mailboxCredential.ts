import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { hashPassword } from "better-auth/crypto";
import { authAccounts, authUsers, emailAccounts, mailAccountMemberships, users } from "../db/schema.js";

type DatabaseTransaction = Parameters<Parameters<typeof import("../db/client.js").db.transaction>[0]>[0];

export async function upsertMailboxCredential(
  tx: DatabaseTransaction,
  input: { accountId: string; address: string; displayName: string | null; productUserId: string; password: string; },
): Promise<string> {
  const password = await hashPassword(input.password);
  const [existingAuth] = await tx.select({ id: authUsers.id }).from(authUsers).where(eq(authUsers.email, input.address)).limit(1);
  const authUserId = existingAuth?.id ?? `mailbox-${randomUUID()}`;
  await tx.insert(authUsers).values({ id: authUserId, name: input.displayName ?? input.address.split("@")[0]!, email: input.address, emailVerified: true }).onConflictDoUpdate({ target: authUsers.id, set: { emailVerified: true, name: input.displayName ?? input.address.split("@")[0]! } });
  const [account] = await tx.select({ id: authAccounts.id }).from(authAccounts).where(and(eq(authAccounts.userId, authUserId), eq(authAccounts.providerId, "credential"))).limit(1);
  if (account) await tx.update(authAccounts).set({ password, accountId: input.address }).where(eq(authAccounts.id, account.id));
  else await tx.insert(authAccounts).values({ id: randomUUID(), accountId: input.address, providerId: "credential", userId: authUserId, password });
  await tx.update(users).set({ authUserId, identityProvider: "better-auth", identitySubject: authUserId, email: input.address, emailVerified: true }).where(eq(users.id, input.productUserId));
  await tx.update(mailAccountMemberships).set({ authUserId }).where(and(eq(mailAccountMemberships.accountId, input.accountId), eq(mailAccountMemberships.userId, input.productUserId)));
  await tx.update(emailAccounts).set({ authSetupStatus: "ready" }).where(eq(emailAccounts.id, input.accountId));
  return authUserId;
}
