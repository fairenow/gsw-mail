import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, pool } from "./client.js";
import {
  authUsers,
  domains,
  emailAccounts,
  mailAccountMemberships,
  mailboxes,
  organizationMemberships,
  organizations,
  users,
  workspaceSetupStates,
} from "./schema.js";

const workspaceName = process.env.NORMALIZE_WORKSPACE_NAME ?? "Guided Steps Wellness";
const workspaceSlug = process.env.NORMALIZE_WORKSPACE_SLUG ?? "guided-steps-wellness";
const domainNames = (process.env.NORMALIZE_DOMAINS ?? "guidedstepswellness.com,team.guidedstepswellness.com")
  .split(",")
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);
const mailboxAddresses = (process.env.NORMALIZE_MAILBOXES ?? "ramon@team.guidedstepswellness.com,alyssa@team.guidedstepswellness.com,support@team.guidedstepswellness.com,admin@team.guidedstepswellness.com,test@team.guidedstepswellness.com")
  .split(",")
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);
const controlEmail = process.env.NORMALIZE_CONTROL_EMAIL;
const controlName = process.env.NORMALIZE_CONTROL_NAME ?? "Workspace Owner";

if (!controlEmail) throw new Error("NORMALIZE_CONTROL_EMAIL must be set to the control-plane backup email");
const normalizedControlEmail = controlEmail.toLowerCase();
if (domainNames.length === 0 || mailboxAddresses.length === 0) throw new Error("NORMALIZE_DOMAINS and NORMALIZE_MAILBOXES cannot be empty");

const mailboxRoles = [
  { role: "inbox", engineName: "Inbox" },
  { role: "sent", engineName: "Sent" },
  { role: "drafts", engineName: "Drafts" },
  { role: "spam", engineName: "Spam" },
  { role: "trash", engineName: "Trash" },
  { role: "archive", engineName: "Archive" },
] as const;

function stableId(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

function splitAddress(address: string): { localPart: string; domainName: string } {
  const at = address.lastIndexOf("@");
  if (at < 1) throw new Error(`invalid mailbox address: ${address}`);
  return { localPart: address.slice(0, at), domainName: address.slice(at + 1) };
}

async function normalize() {
  await db.transaction(async (tx) => {
    const [createdWorkspace] = await tx.insert(organizations).values({ name: workspaceName, slug: workspaceSlug }).onConflictDoNothing({ target: organizations.slug }).returning({ id: organizations.id });
    const workspaceId = createdWorkspace?.id ?? (await tx.select({ id: organizations.id }).from(organizations).where(eq(organizations.slug, workspaceSlug)).limit(1))[0]?.id;
    if (!workspaceId) throw new Error("could not resolve normalized workspace");

    const domainIds = new Map<string, string>();
    for (const name of domainNames) {
      const existing = (await tx.select({ id: domains.id, organizationId: domains.organizationId }).from(domains).where(eq(domains.name, name)).limit(1))[0];
      if (existing && existing.organizationId !== workspaceId) throw new Error(`domain ${name} belongs to another workspace`);
      const [domain] = existing ? [existing] : await tx.insert(domains).values({ organizationId: workspaceId, name, status: "pending" }).returning({ id: domains.id, organizationId: domains.organizationId });
      if (!domain) throw new Error(`could not normalize domain ${name}`);
      domainIds.set(name, domain.id);
    }

    const authId = `control-${stableId(normalizedControlEmail)}`;
    const [authUser] = await tx.insert(authUsers).values({ id: authId, name: controlName, email: normalizedControlEmail, emailVerified: false }).onConflictDoUpdate({ target: authUsers.email, set: { name: controlName } }).returning({ id: authUsers.id });
    const resolvedAuthId = authUser?.id ?? (await tx.select({ id: authUsers.id }).from(authUsers).where(eq(authUsers.email, normalizedControlEmail)).limit(1))[0]?.id;
    if (!resolvedAuthId) throw new Error("could not normalize control identity");

    const controlUserId = `better-auth-${resolvedAuthId}`;
    await tx.insert(users).values({ id: controlUserId, authUserId: resolvedAuthId, identityProvider: "better-auth", identitySubject: resolvedAuthId, email: normalizedControlEmail, emailVerified: false, name: controlName }).onConflictDoUpdate({ target: users.id, set: { authUserId: resolvedAuthId, email: normalizedControlEmail, name: controlName } });
    await tx.insert(organizationMemberships).values({ organizationId: workspaceId, userId: controlUserId, role: "owner", status: "active" }).onConflictDoUpdate({ target: [organizationMemberships.organizationId, organizationMemberships.userId], set: { role: "owner", status: "active" } });

    for (const address of mailboxAddresses) {
      const { localPart, domainName } = splitAddress(address);
      const domainId = domainIds.get(domainName);
      if (!domainId) throw new Error(`mailbox ${address} uses a domain outside NORMALIZE_DOMAINS`);
      const mailboxUserId = `legacy-mailbox-${stableId(address)}`;
      const [mailboxAuth] = await tx.select({ id: authUsers.id }).from(authUsers).where(eq(authUsers.email, address)).limit(1);
      await tx.insert(users).values({ id: mailboxUserId, authUserId: mailboxAuth?.id, identityProvider: "legacy-mailbox", identitySubject: address, email: address, emailVerified: true, name: localPart }).onConflictDoUpdate({ target: users.id, set: { authUserId: mailboxAuth?.id, email: address, name: localPart } });
      const existingAccount = (await tx.select({ id: emailAccounts.id }).from(emailAccounts).where(eq(emailAccounts.address, address)).limit(1))[0];
      if (!existingAccount) throw new Error(`existing Neon mailbox not found for ${address}; adoption will not create mailboxes`);
      const [account] = await tx.update(emailAccounts).set({ workspaceId, domainId, userId: mailboxUserId, status: "active" }).where(eq(emailAccounts.id, existingAccount.id)).returning({ id: emailAccounts.id });
      if (!account) throw new Error(`could not normalize mailbox ${address}`);
      for (const mailbox of mailboxRoles) await tx.insert(mailboxes).values({ accountId: account.id, role: mailbox.role, engineName: mailbox.engineName }).onConflictDoNothing({ target: [mailboxes.accountId, mailboxes.role] });
      await tx.insert(mailAccountMemberships).values({ accountId: account.id, userId: mailboxUserId, authUserId: mailboxAuth?.id, role: "owner" }).onConflictDoUpdate({ target: [mailAccountMemberships.accountId, mailAccountMemberships.userId], set: { authUserId: mailboxAuth?.id, role: "owner" } });
    }

    await tx.insert(workspaceSetupStates).values({ organizationId: workspaceId, currentStep: "complete", completedAt: new Date(), migratedFromExisting: true }).onConflictDoUpdate({ target: workspaceSetupStates.organizationId, set: { currentStep: "complete", completedAt: new Date(), migratedFromExisting: true } });

    console.log(JSON.stringify({ workspaceId, controlAuthUserId: resolvedAuthId, domains: [...domainIds.keys()], mailboxes: mailboxAddresses }, null, 2));
  });
}

normalize().then(() => pool.end()).catch(async (error: unknown) => { console.error(error); await pool.end(); process.exitCode = 1; });
