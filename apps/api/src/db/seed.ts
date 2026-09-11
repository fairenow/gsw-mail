import { and, eq } from "drizzle-orm";
import { db } from "./client.js";
import { aliases, domains, emailAccounts, mailAccountMemberships, mailboxes, organizationMemberships, organizations, users } from "./schema.js";

const ORG = "Guided Steps Wellness";
const DOMAIN = "guidedstepswellness.com";
const ORG_SLUG = "guided-steps-wellness";

async function ensureOrgAndDomain(): Promise<{ organizationId: string; domainId: string }> {
  const [org] = await db.insert(organizations).values({ name: ORG, slug: ORG_SLUG }).onConflictDoNothing().returning();
  const organizationId =
    org?.id ?? (await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.slug, ORG_SLUG)).limit(1))[0]!.id;

  const [domain] = await db
    .insert(domains)
    .values({
      organizationId,
      name: DOMAIN,
      status: "verified",
      mxStatus: "verifying",
      spfStatus: "verifying",
      dkimStatus: "not_configured",
      dmarcStatus: "not_configured",
    })
    .onConflictDoNothing({ target: domains.name })
    .returning();
  const domainId = domain?.id ?? (await db.select({ id: domains.id }).from(domains).where(eq(domains.name, DOMAIN)).limit(1))[0]!.id;

  return { organizationId, domainId };
}

async function ensureUser(id: string, identitySubject: string, email: string, name: string): Promise<string> {
  await db
    .insert(users)
    .values({ id, identityProvider: "gsw", identitySubject, email, emailVerified: true, name })
    .onConflictDoNothing({ target: users.id });
  return id;
}

async function ensureAccount(
  domainId: string,
  localPart: string,
  address: string,
  displayName: string,
  ownerUserId: string,
): Promise<string> {
  const [account] = await db
    .insert(emailAccounts)
    .values({
      domainId,
      userId: ownerUserId,
      localPart,
      address,
      displayName,
      status: "active",
      quotaBytes: 5_000_000_000,
    })
    .onConflictDoNothing({ target: emailAccounts.address })
    .returning();
  const accountId = account?.id ?? (await db.select({ id: emailAccounts.id }).from(emailAccounts).where(eq(emailAccounts.address, address)).limit(1))[0]!.id;

  const seedRoles = [
    { role: "inbox", engineName: "Inbox" },
    { role: "sent", engineName: "Sent" },
    { role: "drafts", engineName: "Drafts" },
    { role: "spam", engineName: "Spam" },
    { role: "trash", engineName: "Trash" },
    { role: "archive", engineName: "Archive" },
  ] as const;
  for (const m of seedRoles) {
    await db.insert(mailboxes).values({ accountId, role: m.role, engineName: m.engineName }).onConflictDoNothing().returning();
  }
  return accountId;
}

async function ensureMembership(accountId: string, userId: string, role: "owner" | "delegate" | "read_only"): Promise<void> {
  const existing = await db
    .select({ id: mailAccountMemberships.id })
    .from(mailAccountMemberships)
    .where(and(eq(mailAccountMemberships.accountId, accountId), eq(mailAccountMemberships.userId, userId)))
    .limit(1);
  if (existing[0]) return;
  await db.insert(mailAccountMemberships).values({ accountId, userId, role });
}

async function ensureOrgMembership(organizationId: string, userId: string, role: "owner" | "admin" | "member"): Promise<void> {
  const existing = await db
    .select({ id: organizationMemberships.id })
    .from(organizationMemberships)
    .where(and(eq(organizationMemberships.organizationId, organizationId), eq(organizationMemberships.userId, userId)))
    .limit(1);
  if (existing[0]) return;
  await db.insert(organizationMemberships).values({ organizationId, userId, role });
}

async function ensureSeed() {
  const { organizationId, domainId } = await ensureOrgAndDomain();

  const ramonId = await ensureUser("ramon-dev", "ramon-dev", "ramon@guidedstepswellness.com", "Ramon Williams");
  const alyssaId = await ensureUser("alyssa-dev", "alyssa-dev", "alyssa@guidedstepswellness.com", "Alyssa Morgan");

  await ensureOrgMembership(organizationId, ramonId, "owner");
  await ensureOrgMembership(organizationId, alyssaId, "member");

  const ramonAccountId = await ensureAccount(domainId, "ramon", "ramon@guidedstepswellness.com", "Ramon Williams", ramonId);
  const alyssaAccountId = await ensureAccount(domainId, "alyssa", "alyssa@guidedstepswellness.com", "Alyssa Morgan", alyssaId);
  const communityAccountId = await ensureAccount(domainId, "community", "community@guidedstepswellness.com", "Community", ramonId);

  await ensureMembership(ramonAccountId, ramonId, "owner");
  await ensureMembership(ramonAccountId, alyssaId, "delegate");
  await ensureMembership(alyssaAccountId, alyssaId, "owner");
  await ensureMembership(communityAccountId, ramonId, "owner");
  await ensureMembership(communityAccountId, alyssaId, "delegate");

  await db
    .insert(aliases)
    .values({ domainId, source: "hello", targetAccountId: communityAccountId })
    .onConflictDoNothing();

  console.log("seeded:");
  console.log("  organization:", ORG);
  console.log("  domain:", DOMAIN);
  console.log("  users: ramon-dev (owner), alyssa-dev (member)");
  console.log("  accounts: ramon@ (owner ramon), alyssa@ (owner alyssa), community@ (owner ramon, delegate alyssa)");
  console.log("  mailboxes: Inbox, Sent, Drafts, Spam, Trash, Archive");
  console.log("  alias: hello@ -> community@");
}

ensureSeed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });