import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { requireOrgPermission } from "../auth/authorize.js";
import { db } from "../db/client.js";
import { domains, emailAccounts, mailAccountMemberships, mailboxes, organizationMemberships, users } from "../db/schema.js";
import { badRequest, notFound } from "../lib/errors.js";

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
          quotaBytes: input.quotaBytes,
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
