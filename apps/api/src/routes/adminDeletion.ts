import { assertWorkspaceUserDeletion } from "./adminDeletionPolicy.js";
import type { FastifyInstance } from "fastify";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { requireOrgPermission, invalidateAccountPermissions } from "../auth/authorize.js";
import { requireUser } from "../auth/middleware.js";
import { db } from "../db/client.js";
import { authUsers, emailAccounts, mailAccountMemberships, organizationMemberships, outboundMessages, users } from "../db/schema.js";
import { destroyMailboxAccount } from "../engine/accountLifecycle.js";
import { badRequest, forbidden, notFound, serviceUnavailable } from "../lib/errors.js";
import { audit } from "../lib/audit.js";

const inputSchema = z.object({ organizationId: z.string().uuid(), confirmation: z.string().min(1) });
export default async function adminDeletion(app: FastifyInstance) {
  await requireUser(app, { optional: false });
  app.delete<{ Params: { id: string } }>("/admin/mailboxes/:id", async (req) => {
    const input = inputSchema.parse(req.body);
    z.string().uuid().parse(req.params.id);
    await requireOrgPermission(req.user!.id, input.organizationId, ["owner", "admin"]);
    const [account] = await db.select().from(emailAccounts).where(and(eq(emailAccounts.id, req.params.id), eq(emailAccounts.workspaceId, input.organizationId))).limit(1);
    if (!account) throw notFound("mailbox not found");
    if (input.confirmation !== account.address) throw badRequest("Type the exact mailbox address to confirm deletion");
    if (account.userId) {
      const [owner] = await db.select().from(organizationMemberships).where(and(eq(organizationMemberships.organizationId, input.organizationId), eq(organizationMemberships.userId, account.userId))).limit(1);
      if (owner?.role === "admin") await requireOrgPermission(req.user!.id, input.organizationId, ["owner"]);
      if (owner?.role === "owner" || account.userId === req.user!.id) throw forbidden("Transfer workspace ownership or use a different admin before deleting this mailbox");
    }
    await db.update(emailAccounts).set({ status: "disabled" }).where(eq(emailAccounts.id, account.id));
    invalidateAccountPermissions();
    try { await destroyMailboxAccount(account.address, account.stalwartPrincipalId); }
    catch { throw serviceUnavailable("Mailbox disabled, but mail server deletion could not be confirmed. Retry Delete mailbox to finish."); }
    await db.transaction(async tx => {
      await tx.delete(outboundMessages).where(eq(outboundMessages.accountId, account.id));
      await tx.delete(emailAccounts).where(eq(emailAccounts.id, account.id));
      const [identity] = await tx.select().from(authUsers).where(eq(authUsers.email, account.address)).limit(1);
      if (identity) {
        const otherAccess = await tx.select({ id: mailAccountMemberships.id }).from(mailAccountMemberships).where(eq(mailAccountMemberships.authUserId, identity.id)).limit(1);
        const linked = await tx.select({ id: users.id }).from(users).where(eq(users.authUserId, identity.id));
        const privileged = linked.length ? await tx.select().from(organizationMemberships).where(and(inArray(organizationMemberships.userId, linked.map(user => user.id)), inArray(organizationMemberships.role, ["owner", "admin"]))).limit(1) : [];
        if (!otherAccess.length && !privileged.length && identity.id !== req.authUserId) await tx.delete(authUsers).where(eq(authUsers.id, identity.id));
      }
    });
    invalidateAccountPermissions();
    await audit({ actorUserId: req.user!.id, organizationId: input.organizationId, action: "mailbox.deleted", resourceType: "email_account", resourceId: account.id, metadata: { address: account.address }, request: req });
    return { deleted: true };
  });
  app.delete<{ Params: { id: string } }>("/admin/users/:id", async (req) => {
    const input = inputSchema.parse(req.body);
    await requireOrgPermission(req.user!.id, input.organizationId, ["owner", "admin"]);
    await db.transaction(async tx => {
      await tx.select({ id: organizationMemberships.id }).from(organizationMemberships).where(eq(organizationMemberships.organizationId, input.organizationId)).for("update");
      const [membership] = await tx.select().from(organizationMemberships).where(and(eq(organizationMemberships.organizationId, input.organizationId), eq(organizationMemberships.userId, req.params.id))).limit(1);
      const [target] = await tx.select().from(users).where(eq(users.id, req.params.id)).limit(1);
      if (!membership || !target) throw notFound("workspace user not found");
      const [actor] = await tx.select().from(organizationMemberships).where(and(eq(organizationMemberships.organizationId, input.organizationId), eq(organizationMemberships.userId, req.user!.id))).limit(1);
      if (!actor || actor.status !== "active" || !["owner", "admin"].includes(actor.role)) throw forbidden();
      const owned = await tx.select({ id: emailAccounts.id }).from(emailAccounts).where(and(eq(emailAccounts.workspaceId, input.organizationId), eq(emailAccounts.userId, target.id))).limit(1);
      assertWorkspaceUserDeletion({ actorId: req.user!.id, actorRole: actor.role, targetId: target.id, targetRole: membership.role, ownsMailboxes: owned.length > 0, email: target.email, confirmation: input.confirmation });
      const accounts = await tx.select({ id: emailAccounts.id }).from(emailAccounts).where(eq(emailAccounts.workspaceId, input.organizationId));
      if (accounts.length) await tx.delete(mailAccountMemberships).where(and(eq(mailAccountMemberships.userId, target.id), inArray(mailAccountMemberships.accountId, accounts.map(a => a.id))));
      await tx.delete(organizationMemberships).where(eq(organizationMemberships.id, membership.id));
    });
    invalidateAccountPermissions();
    await audit({ actorUserId: req.user!.id, organizationId: input.organizationId, action: "workspace.user_deleted", resourceType: "user", resourceId: req.params.id, request: req });
    return { deleted: true };
  });
}
