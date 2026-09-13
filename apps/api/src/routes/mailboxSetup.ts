import { createHash, randomInt, randomUUID } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { hashPassword } from "better-auth/crypto";
import { z } from "zod";
import { requireOrgPermission } from "../auth/authorize.js";
import { sendAuthEmail } from "../auth/better.js";
import { requireUser } from "../auth/middleware.js";
import { db } from "../db/client.js";
import { authAccounts, authUsers, domains, emailAccounts, mailboxAuthSetupTokens, mailAccountMemberships, users } from "../db/schema.js";
import { badRequest, notFound } from "../lib/errors.js";
import { renderGswAuthEmail } from "../auth/email.js";

const passwordSchema = z.object({ code: z.string().regex(/^\d{6}$/), password: z.string().min(8).max(200) });

function codeHash(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

export default async function mailboxSetupRoutes(app: FastifyInstance) {
  await requireUser(app, { optional: false });

  app.post<{ Params: { id: string } }>("/api/mailboxes/:id/setup", async (req) => {
    const [row] = await db.select({ accountId: emailAccounts.id, address: emailAccounts.address, displayName: emailAccounts.displayName, organizationId: emailAccounts.workspaceId, authSetupStatus: emailAccounts.authSetupStatus }).from(emailAccounts).innerJoin(domains, eq(emailAccounts.domainId, domains.id)).where(eq(emailAccounts.id, req.params.id)).limit(1);
    if (!row) throw notFound("mailbox not found");
    await requireOrgPermission(req.user!.id, row.organizationId, ["owner", "admin"]);
    if (row.authSetupStatus === "ready") throw badRequest("mailbox login is already set up");
    const code = String(randomInt(100000, 1000000));
    const now = new Date();
    await db.update(mailboxAuthSetupTokens).set({ usedAt: now }).where(and(eq(mailboxAuthSetupTokens.accountId, row.accountId), isNull(mailboxAuthSetupTokens.usedAt)));
    await db.insert(mailboxAuthSetupTokens).values({ accountId: row.accountId, requestedByUserId: req.user!.id, recoveryEmail: req.user!.email!, codeHash: codeHash(code), expiresAt: new Date(Date.now() + 10 * 60_000) });
    await sendAuthEmail(req.user!.email!, `Set up ${row.address} in GSW Mail`, renderGswAuthEmail({ title: "Set up your mailbox login", message: `Use this code to create a GSW password for ${row.address}.`, code, expiryMinutes: 10 }));
    return { sent: true, recoveryEmail: req.user!.email, address: row.address };
  });

  app.post<{ Params: { id: string }; Body: unknown }>("/api/mailboxes/:id/setup/complete", async (req) => {
    const input = passwordSchema.parse(req.body);
    const [row] = await db.select({ accountId: emailAccounts.id, address: emailAccounts.address, displayName: emailAccounts.displayName, workspaceId: emailAccounts.workspaceId, userId: emailAccounts.userId, authSetupStatus: emailAccounts.authSetupStatus }).from(emailAccounts).where(eq(emailAccounts.id, req.params.id)).limit(1);
    if (!row) throw notFound("mailbox not found");
    if (!row.userId) throw badRequest("mailbox is missing its product identity");
    const productUserId = row.userId;
    await requireOrgPermission(req.user!.id, row.workspaceId, ["owner", "admin"]);
    const [token] = await db.select().from(mailboxAuthSetupTokens).where(and(eq(mailboxAuthSetupTokens.accountId, row.accountId), isNull(mailboxAuthSetupTokens.usedAt))).orderBy(desc(mailboxAuthSetupTokens.createdAt)).limit(1);
    if (!token || token.expiresAt <= new Date() || token.attempts >= 5 || token.codeHash !== codeHash(input.code)) {
      if (token) await db.update(mailboxAuthSetupTokens).set({ attempts: token.attempts + 1 }).where(eq(mailboxAuthSetupTokens.id, token.id));
      throw badRequest("invalid or expired mailbox setup code");
    }
    const password = await hashPassword(input.password);
    const [existingAuth] = await db.select({ id: authUsers.id }).from(authUsers).where(eq(authUsers.email, row.address)).limit(1);
    const authUserId = existingAuth?.id ?? `mailbox-${randomUUID()}`;
    await db.transaction(async (tx) => {
      await tx.insert(authUsers).values({ id: authUserId, name: row.displayName ?? row.address.split("@")[0]!, email: row.address, emailVerified: true }).onConflictDoUpdate({ target: authUsers.id, set: { emailVerified: true, name: row.displayName ?? row.address.split("@")[0]! } });
      const [account] = await tx.select({ id: authAccounts.id }).from(authAccounts).where(and(eq(authAccounts.userId, authUserId), eq(authAccounts.providerId, "credential"))).limit(1);
      if (account) await tx.update(authAccounts).set({ password, accountId: row.address }).where(eq(authAccounts.id, account.id));
      else await tx.insert(authAccounts).values({ id: randomUUID(), accountId: row.address, providerId: "credential", userId: authUserId, password });
      await tx.update(users).set({ authUserId, identityProvider: "better-auth", identitySubject: authUserId, email: row.address, emailVerified: true }).where(eq(users.id, productUserId));
      await tx.update(mailAccountMemberships).set({ authUserId }).where(eq(mailAccountMemberships.accountId, row.accountId));
      await tx.update(emailAccounts).set({ authSetupStatus: "ready" }).where(eq(emailAccounts.id, row.accountId));
      await tx.update(mailboxAuthSetupTokens).set({ usedAt: new Date() }).where(eq(mailboxAuthSetupTokens.id, token.id));
    });
    return { ready: true, address: row.address };
  });
}
