import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { emailAccounts } from "../db/schema.js";
import { forbidden, notFound } from "../lib/errors.js";

export async function getOwnedAccount(accountId: string, userId: string) {
  const rows = await db.select().from(emailAccounts).where(eq(emailAccounts.id, accountId)).limit(1);
  const account = rows[0];
  if (!account) throw notFound("account not found");
  if (account.userId !== userId) throw forbidden();
  return account;
}