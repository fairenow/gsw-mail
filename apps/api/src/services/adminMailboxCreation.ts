import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { requireOrgPermission } from "../auth/authorize.js";
import { db } from "../db/client.js";
import { domains, emailAccounts, mailAccountMemberships, mailboxes, organizationMemberships, users } from "../db/schema.js";
import { badRequest, HttpError, notFound } from "../lib/errors.js";
import { MAILBOX_STORAGE_BYTES } from "../billing/pricing.js";

export const adminMailboxCreateSchema = z.object({
  organizationId: z.string().uuid(),
  domainId: z.string().uuid(),
  localPart: z.string().trim().regex(/^[a-z0-9._%+-]+$/i),
  displayName: z.string().trim().optional(),
  quotaBytes: z.number().int().positive().optional(),
  ownerUserId: z.string().trim().min(1).optional(),
});
export async function createAdminMailbox(actorUserId: string, rawInput: unknown) {
  const input = adminMailboxCreateSchema.parse(rawInput);
    const orgId = input.organizationId;
    await requireOrgPermission(actorUserId, orgId, ["owner", "admin"]);
    const domainRow = await db
      .select({ id: domains.id, name: domains.name, organizationId: domains.organizationId, status: domains.status })
      .from(domains)
      .where(eq(domains.id, input.domainId))
      .limit(1);
    const domain = domainRow[0];
    if (!domain) throw notFound("domain not found");
    if (domain.organizationId !== orgId) throw badRequest("domain does not belong to your organization");
    if (domain.status !== "verified") throw badRequest("domain must be verified before creating a mailbox");
    const address = `${input.localPart.toLowerCase()}@${domain.name}`;

    const account = await db.transaction(async (tx) => {
      // Explicit rollout switch: production mailbox creation remains unchanged until billing is approved.
      // Transaction-scoped advisory locking prevents concurrent creates exceeding licensed seats.
      if (process.env.STRIPE_ENFORCE_SUBSCRIPTIONS === "true") {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${orgId}))`);
        const entitlement = await tx.execute(sql`
          SELECT o.legacy_free_for_life AS legacy,
            s.status AS subscription_status, s.mailbox_quantity AS licensed_mailboxes,
            (SELECT count(*)::integer FROM email_accounts ea
              WHERE ea.workspace_id = o.id AND ea.account_status != 'disabled') AS used_mailboxes
          FROM organizations o LEFT JOIN billing_subscriptions s ON s.organization_id = o.id
          WHERE o.id = ${orgId}
        `);
        const row = entitlement.rows[0] as {legacy?:boolean;subscription_status?:string;licensed_mailboxes?:number;used_mailboxes?:number}|undefined;
        if (!row) throw notFound("workspace not found");
        if (!row.legacy) {
          if (!["active","trialing"].includes(row.subscription_status ?? ""))
            throw new HttpError(402,"billing_subscription_required");
          if ((row.used_mailboxes ?? 0) >= (row.licensed_mailboxes ?? 0))
            throw new HttpError(402,"mailbox_license_limit_reached");
        }
      }
      let ownerUserId = input.ownerUserId;
      let ownerAuthUserId: string | null = null;

      if (ownerUserId) {
        const [owner] = await tx.select({ id: users.id, authUserId: users.authUserId }).from(users).where(eq(users.id, ownerUserId)).limit(1);
        if (!owner) throw badRequest("ownerUserId must reference an existing user");
        const [membership] = await tx
          .select({ role: organizationMemberships.role, status: organizationMemberships.status })
          .from(organizationMemberships)
          .where(and(eq(organizationMemberships.organizationId, orgId), eq(organizationMemberships.userId, ownerUserId)))
          .limit(1);
        if (membership?.status !== "active") throw badRequest("mailbox owner must be an active workspace member");
        if (membership.role === "owner" || membership.role === "admin") {
          throw badRequest("workspace owner/admin identities cannot be used as mailbox identities");
        }
        ownerAuthUserId = owner.authUserId;
      } else {
        ownerUserId = `mailbox-user-${randomUUID()}`;
        await tx.insert(users).values({
          id: ownerUserId,
          identityProvider: "gsw-mailbox-pending",
          identitySubject: ownerUserId,
          email: address,
          emailVerified: false,
          name: input.displayName || input.localPart,
          status: "active",
        });
        await tx.insert(organizationMemberships).values({
          organizationId: orgId,
          userId: ownerUserId,
          role: "member",
          status: "active",
        });
      }

      const [created] = await tx
        .insert(emailAccounts)
        .values({
          workspaceId: domain.organizationId,
          domainId: input.domainId,
          userId: ownerUserId,
          localPart: input.localPart.toLowerCase(),
          address,
          displayName: input.displayName,
          quotaBytes: Math.max(input.quotaBytes ?? 0, MAILBOX_STORAGE_BYTES),
        })
        .returning();
      if (!created) throw new Error("failed to create account");
      await tx.insert(mailboxes).values([
        { accountId: created.id, role: "inbox", engineName: "Inbox" },
        { accountId: created.id, role: "sent", engineName: "Sent" },
        { accountId: created.id, role: "drafts", engineName: "Drafts" },
        { accountId: created.id, role: "spam", engineName: "Spam" },
        { accountId: created.id, role: "trash", engineName: "Trash" },
        { accountId: created.id, role: "archive", engineName: "Archive" },
      ]);
      await tx.insert(mailAccountMemberships).values({
        accountId: created.id,
        userId: ownerUserId,
        ...(ownerAuthUserId ? { authUserId: ownerAuthUserId } : {}),
        role: "owner",
      });
      return created;
    });

  return account;
}
