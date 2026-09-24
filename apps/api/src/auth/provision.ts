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

export async function provisionControlPlaneUser(identitySubject: string, email: string, name?: string, database: Pick<typeof db, "transaction"> = db): Promise<ProvisionedUser> {
  const normalizedEmail = email.trim().toLowerCase();
  const displayName = name?.trim() || displayNameFromAddress(normalizedEmail);
  return database.transaction(async (tx) => {
    const deterministicId = `better-auth-${identitySubject}`;
    const directUser = (await tx.select().from(users).where(eq(users.authUserId, identitySubject)).limit(1))[0]
      ?? (await tx.select().from(users).where(eq(users.id, deterministicId)).limit(1))[0];

    const emailMatches = (await tx.select().from(users).where(eq(users.email, normalizedEmail)))
      .filter((candidate) => candidate.status === "active");

    const hasMailboxData = async (userId: string) => {
      const owned = await tx.select({ id: emailAccounts.id }).from(emailAccounts).where(eq(emailAccounts.userId, userId)).limit(1);
      if (owned[0]) return true;
      const membership = await tx.select({ id: mailAccountMemberships.id }).from(mailAccountMemberships).where(eq(mailAccountMemberships.userId, userId)).limit(1);
      return Boolean(membership[0]);
    };

    const detachDirectAuthLink = async () => {
      if (directUser?.authUserId === identitySubject) {
        await tx.update(users).set({ authUserId: null }).where(eq(users.id, directUser.id));
      }
    };

    let existing = directUser;
    let preserveExistingEmail = false;
    const directHasMailboxData = directUser ? await hasMailboxData(directUser.id) : false;
    const alternateWithMailboxData: typeof emailMatches = [];
    for (const candidate of emailMatches) {
      if (candidate.id === directUser?.id) continue;
      if (await hasMailboxData(candidate.id)) alternateWithMailboxData.push(candidate);
    }

    // A Better Auth identity can already have a freshly auto-provisioned product
    // row while the user's real mailbox/settings/contacts still live on an older
    // product row with the same verified login email. Prefer the data-bearing row
    // when that relationship is unambiguous.
    if (directUser && !directHasMailboxData && alternateWithMailboxData.length === 1) {
      const target = alternateWithMailboxData[0]!;
      if (target.authUserId && target.authUserId !== identitySubject) throw new Error("account linkage unavailable");
      await detachDirectAuthLink();
      existing = target;
    } else if (!directUser) {
      if (alternateWithMailboxData.length === 1) existing = alternateWithMailboxData[0]!;
      else if (emailMatches.length === 1) existing = emailMatches[0]!;
      else if (alternateWithMailboxData.length > 1 || emailMatches.length > 1) throw new Error("account linkage unavailable");
    }

    // Mailbox sign-in identities are authoritative when the verified Better Auth
    // email is itself an existing GSW mailbox address. This covers migrated users
    // whose product-user email is an owner/recovery address rather than the mailbox
    // address. Reconnect to the mailbox's existing owner instead of creating an
    // empty product row for Mobile.
    const selectedHasMailboxData = existing
      ? (existing.id === directUser?.id ? directHasMailboxData : await hasMailboxData(existing.id))
      : false;
    if (!selectedHasMailboxData && alternateWithMailboxData.length === 0) {
      const [mailbox] = await tx
        .select({ id: emailAccounts.id, userId: emailAccounts.userId })
        .from(emailAccounts)
        .where(eq(emailAccounts.address, normalizedEmail))
        .limit(1);
      let mailboxOwnerUserId = mailbox?.userId ?? null;
      if (mailbox && !mailboxOwnerUserId) {
        const [ownerMembership] = await tx
          .select({ userId: mailAccountMemberships.userId })
          .from(mailAccountMemberships)
          .where(and(eq(mailAccountMemberships.accountId, mailbox.id), eq(mailAccountMemberships.role, "owner")))
          .limit(1);
        mailboxOwnerUserId = ownerMembership?.userId ?? null;
      }
      if (mailboxOwnerUserId && mailboxOwnerUserId !== existing?.id) {
        const [mailboxOwner] = await tx.select().from(users).where(eq(users.id, mailboxOwnerUserId)).limit(1);
        if (!mailboxOwner || mailboxOwner.status !== "active") throw new Error("account linkage unavailable");
        if (mailboxOwner.authUserId && mailboxOwner.authUserId !== identitySubject) throw new Error("account linkage unavailable");
        await detachDirectAuthLink();
        existing = mailboxOwner;
        preserveExistingEmail = true;
      }
    }

    if (existing) {
      if (existing.status !== "active") throw new Error("account linkage unavailable");
      if (existing.authUserId && existing.authUserId !== identitySubject) throw new Error("account linkage unavailable");
      await tx.update(users).set({ authUserId: identitySubject, email: preserveExistingEmail ? existing.email : normalizedEmail, name: existing.name ?? displayName, emailVerified: true, lastLoginAt: new Date() }).where(eq(users.id, existing.id));
      await tx.update(mailAccountMemberships).set({ authUserId: identitySubject }).where(eq(mailAccountMemberships.userId, existing.id));
      const owned = await tx.select().from(emailAccounts).where(eq(emailAccounts.userId, existing.id));
      for (const account of owned) {
        if (account.authSetupStatus !== "ready") continue;
        await tx.insert(mailAccountMemberships).values({ accountId: account.id, userId: existing.id, authUserId: identitySubject, role: "owner" }).onConflictDoNothing();
        await tx.insert(organizationMemberships).values({ organizationId: account.workspaceId, userId: existing.id, role: "member", status: "active" }).onConflictDoNothing();
      }
      return { id: existing.id, email: normalizedEmail };
    }

    const workspaceSlug = `${config.provisioning.organizationSlug}-${createHash("sha256").update(identitySubject).digest("hex").slice(0, 12)}`;
    const [organization] = await tx.insert(organizations).values({ name: config.provisioning.organizationName, slug: workspaceSlug }).returning({ id: organizations.id });
    const organizationId = organization?.id;
    if (!organizationId) throw new Error("failed to provision workspace");
    const [user] = await tx
      .insert(users)
      .values({ id: deterministicId, authUserId: identitySubject, identityProvider: "better-auth", identitySubject, email: normalizedEmail, emailVerified: true, name: displayName, lastLoginAt: new Date() })
      .onConflictDoUpdate({ target: users.id, set: { authUserId: identitySubject, email: normalizedEmail, name: displayName, emailVerified: true, lastLoginAt: new Date() } })
      .returning({ id: users.id });
    if (!user) throw new Error("failed to provision control-plane user");
    await tx.insert(organizationMemberships).values({ organizationId, userId: user.id, role: "owner", status: "active" }).onConflictDoUpdate({ target: [organizationMemberships.organizationId, organizationMemberships.userId], set: { role: "owner", status: "active" } });
    return { id: user.id, email: normalizedEmail };
  });
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
      const [account] = await tx.insert(emailAccounts).values({ workspaceId: organizationId, domainId, userId, localPart: address.slice(0, address.lastIndexOf("@")), address, displayName, status: "active", quotaBytes: config.provisioning.defaultQuotaBytes }).returning({ id: emailAccounts.id });
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
