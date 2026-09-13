import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { auth } from "../auth/better.js";
import { db } from "../db/client.js";
import { authUsers, domains, emailAccounts, organizationMemberships, users } from "../db/schema.js";
import { badRequest } from "../lib/errors.js";

const requestSchema = z.object({ email: z.string().trim().toLowerCase().email() });
const completeSchema = z.object({ email: z.string().trim().toLowerCase().email(), otp: z.string().regex(/^\d{6}$/), newPassword: z.string().min(8).max(200) });

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "your recovery email";
  return `${local.slice(0, 1)}${"*".repeat(Math.max(2, Math.min(local.length - 1, 4)))}@${domain}`;
}

export default async function recoveryRoutes(app: FastifyInstance) {
  app.post("/api/account/request-password-reset", async (req) => {
    const { email } = requestSchema.parse(req.body);
    const [mailbox] = await db.select({ address: emailAccounts.address, workspaceId: emailAccounts.workspaceId }).from(emailAccounts).where(eq(emailAccounts.address, email)).limit(1);
    let recoveryEmail = email;
    let recoveryType: "workspace-recovery" | "self" = "self";
    if (mailbox) {
      const [owner] = await db.select({ email: authUsers.email }).from(organizationMemberships).innerJoin(users, eq(organizationMemberships.userId, users.id)).innerJoin(authUsers, eq(users.authUserId, authUsers.id)).where(and(eq(organizationMemberships.organizationId, mailbox.workspaceId), eq(organizationMemberships.role, "owner"), eq(organizationMemberships.status, "active"))).limit(1);
      if (owner?.email) { recoveryEmail = owner.email; recoveryType = "workspace-recovery"; }
    }
    req.log.info({ targetEmail: email, recoveryEmail, recoveryType }, "password reset requested");
    await auth.api.requestPasswordResetEmailOTP({ body: { email } });
    return { success: true, recoveryType, maskedRecoveryEmail: maskEmail(recoveryEmail), targetEmail: email };
  });

  app.post("/api/account/complete-password-reset", async (req) => {
    const input = completeSchema.parse(req.body);
    req.log.info({ targetEmail: input.email }, "password reset completed");
    try {
      await auth.api.resetPasswordEmailOTP({ body: { email: input.email, otp: input.otp, password: input.newPassword } });
    } catch (error) {
      req.log.info({ targetEmail: input.email, error: error instanceof Error ? error.message : "reset failed" }, "password reset rejected");
      throw badRequest("invalid or expired password reset code");
    }
    return { success: true };
  });
}
