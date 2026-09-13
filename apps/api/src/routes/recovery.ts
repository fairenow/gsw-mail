import { createHash, randomInt } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { auth, sendAuthEmailWithResult } from "../auth/better.js";
import { renderGswAuthEmail } from "../auth/email.js";
import { upsertMailboxCredential } from "../auth/mailboxCredential.js";
import { db } from "../db/client.js";
import { authUsers, emailAccounts, mailboxRecoveryTokens, organizationMemberships, users } from "../db/schema.js";
import { badRequest } from "../lib/errors.js";

const requestSchema = z.object({ email: z.string().trim().toLowerCase().email() });
const completeSchema = z.object({ email: z.string().trim().toLowerCase().email(), otp: z.string().regex(/^\d{6}$/), newPassword: z.string().min(8).max(200) });
type PasswordResetOtpApi = {
  requestPasswordResetEmailOTP(input: { body: { email: string } }): Promise<unknown>;
  resetPasswordEmailOTP(input: { body: { email: string; otp: string; password: string } }): Promise<unknown>;
};

function codeHash(code: string): string { return createHash("sha256").update(code).digest("hex"); }
function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "your recovery email";
  return `${local.slice(0, 1)}${"*".repeat(Math.max(2, Math.min(local.length - 1, 4)))}@${domain}`;
}

export default async function recoveryRoutes(app: FastifyInstance) {
  app.post<{ Body: unknown }>("/api/account/request-password-reset", { config: { rateLimit: { max: 5, timeWindow: "15 minutes" } } }, async (req) => {
    const { email } = requestSchema.parse(req.body);
    const [mailbox] = await db.select({ id: emailAccounts.id, address: emailAccounts.address, workspaceId: emailAccounts.workspaceId }).from(emailAccounts).where(eq(emailAccounts.address, email)).limit(1);
    if (!mailbox) {
      await (auth.api as unknown as PasswordResetOtpApi).requestPasswordResetEmailOTP({ body: { email } });
      return { success: true, recoveryType: "self", maskedRecoveryEmail: maskEmail(email), targetEmail: email } as const;
    }
    const [owner] = await db.select({ email: authUsers.email }).from(organizationMemberships).innerJoin(users, eq(organizationMemberships.userId, users.id)).innerJoin(authUsers, eq(users.authUserId, authUsers.id)).where(and(eq(organizationMemberships.organizationId, mailbox.workspaceId), eq(organizationMemberships.role, "owner"), eq(organizationMemberships.status, "active"), eq(authUsers.emailVerified, true))).limit(1);
    if (!owner?.email) throw badRequest("mailbox recovery is unavailable");
    const code = String(randomInt(100000, 1000000));
    await db.transaction(async (tx) => {
      await tx.update(mailboxRecoveryTokens).set({ usedAt: new Date() }).where(and(eq(mailboxRecoveryTokens.accountId, mailbox.id), isNull(mailboxRecoveryTokens.usedAt)));
      await tx.insert(mailboxRecoveryTokens).values({ accountId: mailbox.id, targetEmail: mailbox.address, recoveryEmail: owner.email, codeHash: codeHash(code), expiresAt: new Date(Date.now() + 10 * 60_000) });
    });
    try {
      const messageId = await sendAuthEmailWithResult(owner.email, `Reset ${mailbox.address}`, renderGswAuthEmail({ title: "Reset your mailbox password", message: `Use this code to reset the password for ${mailbox.address}.`, code, expiryMinutes: 10 }));
      req.log.info({ targetEmail: email, recoveryType: "workspace-recovery", recoveryEmail: maskEmail(owner.email), messageId }, "mailbox recovery email delivered");
    } catch (error) {
      req.log.error({ targetEmail: email, recoveryType: "workspace-recovery", recoveryEmail: maskEmail(owner.email), error }, "mailbox recovery email failed");
      throw error;
    }
    return { success: true, recoveryType: "workspace-recovery", maskedRecoveryEmail: maskEmail(owner.email), targetEmail: email } as const;
  });

  app.post<{ Body: unknown }>("/api/account/complete-password-reset", async (req) => {
    const input = completeSchema.parse(req.body);
    const [mailbox] = await db.select({ id: emailAccounts.id, address: emailAccounts.address, displayName: emailAccounts.displayName, userId: emailAccounts.userId }).from(emailAccounts).where(eq(emailAccounts.address, input.email)).limit(1);
    if (!mailbox) {
      try { await (auth.api as unknown as PasswordResetOtpApi).resetPasswordEmailOTP({ body: { email: input.email, otp: input.otp, password: input.newPassword } }); } catch (error) {
        req.log.info({ targetEmail: input.email, error: error instanceof Error ? error.message : "reset failed" }, "password reset rejected");
        throw badRequest("invalid or expired password reset code");
      }
      return { success: true };
    }
    if (!mailbox.userId) throw badRequest("mailbox is missing its product identity");
    const [token] = await db.select().from(mailboxRecoveryTokens).where(and(eq(mailboxRecoveryTokens.accountId, mailbox.id), isNull(mailboxRecoveryTokens.usedAt))).orderBy(desc(mailboxRecoveryTokens.createdAt)).limit(1);
    if (!token || token.expiresAt <= new Date() || token.attempts >= 5 || token.codeHash !== codeHash(input.otp)) {
      if (token) await db.update(mailboxRecoveryTokens).set({ attempts: token.attempts + 1 }).where(eq(mailboxRecoveryTokens.id, token.id));
      throw badRequest("invalid or expired password reset code");
    }
    await db.transaction(async (tx) => {
      await upsertMailboxCredential(tx, { accountId: mailbox.id, address: mailbox.address, displayName: mailbox.displayName, productUserId: mailbox.userId!, password: input.newPassword });
      await tx.update(mailboxRecoveryTokens).set({ usedAt: new Date() }).where(eq(mailboxRecoveryTokens.id, token.id));
    });
    req.log.info({ targetEmail: input.email, recoveryType: "workspace-recovery", recoveryEmail: maskEmail(token.recoveryEmail) }, "mailbox password reset completed");
    return { success: true };
  });
}
