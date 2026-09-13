import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { config } from "../config.js";
import { db } from "../db/client.js";
import { domains, emailAccounts, mailAccountMemberships, mailboxes, organizationMemberships, organizations, users } from "../db/schema.js";

const mailboxRoles = [
  { role: "inbox", engineName: "Inbox" },
  { role: "sent", engineName: "Sent" },
  { role: "drafts", engineName: "Drafts" },
  { role: "spam", engineName: "Spam" },
  { role: "trash", engineName: "Trash" },
  { role: "archive", engineName: "Archive" },
] as const;

export interface ProvisionUserOptions {
  id?: string;
  email?: string;
  name?: string;
}

export interface ProvisionedUser {
  id: string;
  email: string;
}

export function normalizeIdentitySubject(subject: string): string {
  const normalized = subject.trim().toLowerCase();
  if (!normalized || !normalized.includes("@") || normalized.startsWith("@") || normalized.endsWith("@")) throw new Error("Stalwart identity is not an email address");
  return normalized;
}

export function stableProvisionedUserId(identityProvider: string, identitySubject: string): string {
  const digest = createHash("sha256").update(`${identityProvider}:${identitySubject}`).digest("hex").slice(0, 32);
  return `stalwart-${digest}`;
}

export async function provisionUserFromIdentity(identityProvider: string, subject: string, options: ProvisionUserOptions = {}): Promise<ProvisionedUser> {
  const identitySubject = normalizeIdentitySubject(subject);
  const address = identitySubject;
  const email = options.email?.trim().toLowerCase() || address;
  const displayName = options.name?.trim() || displayNameFromAddress(address);
  const domainName = address.slice(address.lastIndexOf("@") + 1);

  return db.transaction(async (tx) => {
    const domainRows = await tx.select({ id: domains.id, organizationId: domains.organizationId }).from(domains).where(eq(domains.name, domainName)).limit(1);
    let domainId = domainRows[0]?.id;
    let organizationId = domainRows[0]?.organizationId;
    if (!domainId || !organizationId) {
      const [organization] = await tx.insert(organizations).values({ name: config.provisioning.organizationName, slug: config.provisioning.organizationSlug }).onConflictDoNothing({ target: organizations.slug }).returning({ id: organizations.id });
      organizationId = organization?.id ?? (await tx.select({ id: organizations.id }).from(organizations).where(eq(organizations.slug, config.provisioning.organizationSlug)).limit(1))[0]?.id;
      if (!organizationId) throw new Error("failed to provision organization");
      const [domain] = await tx.insert(domains).values({ organizationId, name: domainName, status: "verified", mxStatus: "verifying", spfStatus: "verifying", dkimStatus: "not_configured", dmarcStatus: "not_configured" }).onConflictDoNothing({ target: domains.name }).returning({ id: domains.id });
      domainId = domain?.id ?? (await tx.select({ id: domains.id }).from(domains).where(eq(domains.name, domainName)).limit(1))[0]?.id;
      if (!domainId) throw new Error("failed to provision domain");
    }

    const existingUser = await tx.select({ id: users.id, status: users.status }).from(users).where(and(eq(users.identityProvider, identityProvider), eq(users.identitySubject, identitySubject))).limit(1);
    let userId = existingUser[0]?.id;
    if (userId) {
      if (existingUser[0]!.status !== "active") throw new Error("user is not active");
      await tx.update(users).set({ email, name: displayName, emailVerified: true, lastLoginAt: new Date() }).where(eq(users.id, userId));
    } else {
      userId = options.id ?? stableProvisionedUserId(identityProvider, identitySubject);
      const [created] = await tx.insert(users).values({ id: userId, identityProvider, identitySubject, email, emailVerified: true, name: displayName, lastLoginAt: new Date() }).onConflictDoNothing({ target: [users.identityProvider, users.identitySubject] }).returning({ id: users.id });
      if (created) userId = created.id;
      else {
        const concurrent = await tx.select({ id: users.id, status: users.status }).from(users).where(and(eq(users.identityProvider, identityProvider), eq(users.identitySubject, identitySubject))).limit(1);
        if (!concurrent[0]) throw new Error("failed to provision user");
        if (concurrent[0].status !== "active") throw new Error("user is not active");
        userId = concurrent[0].id;
      }
    }

    await tx.insert(organizationMemberships).values({ organizationId, userId, role: "member", status: "active" }).onConflictDoNothing({ target: [organizationMemberships.organizationId, organizationMemberships.userId] });

    const accountRows = await tx.select({ id: emailAccounts.id, userId: emailAccounts.userId, displayName: emailAccounts.displayName }).from(emailAccounts).where(eq(emailAccounts.address, address)).limit(1);
    const existingAccount = accountRows[0];
    let accountId = existingAccount?.id;
    if (existingAccount?.userId && existingAccount.userId !== userId) throw new Error(`mailbox ${address} is already linked to another user`);
    if (accountId) {
      const existingOwner = await tx.select({ userId: mailAccountMemberships.userId }).from(mailAccountMemberships).where(and(eq(mailAccountMemberships.accountId, accountId), eq(mailAccountMemberships.role, "owner"))).limit(1);
      if (existingOwner[0] && existingOwner[0].userId !== userId) throw new Error(`mailbox ${address} is already owned by another user`);
      await tx.update(emailAccounts).set({ userId, status: "active", displayName: existingAccount?.displayName ?? displayName }).where(eq(emailAccounts.id, accountId));
    } else {
      const [account] = await tx.insert(emailAccounts).values({ domainId, userId, localPart: address.slice(0, address.lastIndexOf("@")), address, displayName, status: "active", quotaBytes: config.provisioning.defaultQuotaBytes }).returning({ id: emailAccounts.id });
      accountId = account?.id;
      if (!accountId) throw new Error("failed to provision mailbox account");
    }

    for (const mailbox of mailboxRoles) await tx.insert(mailboxes).values({ accountId, role: mailbox.role, engineName: mailbox.engineName }).onConflictDoNothing({ target: [mailboxes.accountId, mailboxes.role] });
    await tx.insert(mailAccountMemberships).values({ accountId, userId, role: "owner" }).onConflictDoUpdate({ target: [mailAccountMemberships.accountId, mailAccountMemberships.userId], set: { role: "owner" } });
    return { id: userId, email };
  });
}

function displayNameFromAddress(address: string): string {
  return address.slice(0, address.indexOf("@")).split(/[._-]+/).filter(Boolean).map((part) => part[0]!.toUpperCase() + part.slice(1)).join(" ") || address;
}
