import { and, eq } from "drizzle-orm";
import { db } from "./client.js";
import { aliases, domains, emailAccounts, mailAccountMemberships, mailboxes, organizationMemberships, organizations, users } from "./schema.js";

const ORG = "Guided Steps Wellness";
const ORG_SLUG = "guided-steps-wellness";
const MAIL_DOMAIN = process.env.PROD_SEED_DOMAIN ?? "team.guidedstepswellness.com";
const OWNER_USER_ID = process.env.PROD_SEED_OWNER_ID ?? "ramon-prod";
const OWNER_IDENTITY_SUBJECT = process.env.PROD_SEED_OWNER_SUBJECT ?? "ramon-prod";
const OWNER_EMAIL = process.env.PROD_SEED_OWNER_EMAIL ?? "ramon@guidedstepswellness.com";
const OWNER_NAME = process.env.PROD_SEED_OWNER_NAME ?? "Ramon Williams";
const TEST_LOCAL_PART = "test";
const TEST_ADDRESS = `${TEST_LOCAL_PART}@${MAIL_DOMAIN}`;

async function ensureOrgAndDomain(): Promise<{ organizationId: string; domainId: string }> {
  const [org] = await db.insert(organizations).values({ name: ORG, slug: ORG_SLUG }).onConflictDoNothing().returning();
  const organizationId =
    org?.id ?? (await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.slug, ORG_SLUG)).limit(1))[0]!.id;

  const [domain] = await db
    .insert(domains)
    .values({
      organizationId,
      name: MAIL_DOMAIN,
      status: "verified",
      mxStatus: "verifying",
      spfStatus: "verifying",
      dkimStatus: "not_configured",
      dmarcStatus: "not_configured",
    })
    .onConflictDoNothing({ target: domains.name })
    .returning();
  const domainId = domain?.id ?? (await db.select({ id: domains.id }).from(domains).where(eq(domains.name, MAIL_DOMAIN)).limit(1))[0]!.id;

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
  const accountId =
    account?.id ?? (await db.select({ id: emailAccounts.id }).from(emailAccounts).where(eq(emailAccounts.address, address)).limit(1))[0]!.id;

  const seedRoles = [
    { role: "inbox", engineName: "Inbox" },
    { role: "sent", engineName: "Sent" },
    { role: "drafts", engineName: "Drafts" },
    { role: "spam", engineName: "Spam" },
    { role: "trash", engineName: "Trash" },
    { role: "archive", engineName: "Archive" },
  ] as const;
  for (const m of seedRoles) {
    await db.insert(mailboxes).values({ accountId, role: m.role, engineName: m.engineName }).onConflictDoNothing();
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

  const ownerUserId = await ensureUser(OWNER_USER_ID, OWNER_IDENTITY_SUBJECT, OWNER_EMAIL, OWNER_NAME);
  await ensureOrgMembership(organizationId, ownerUserId, "owner");

  const testAccountId = await ensureAccount(domainId, TEST_LOCAL_PART, TEST_ADDRESS, "Test Mailbox", ownerUserId);
  await ensureMembership(testAccountId, ownerUserId, "owner");

  await db
    .insert(aliases)
    .values([
      { domainId, source: "postmaster", targetAccountId: testAccountId },
      { domainId, source: "abuse", targetAccountId: testAccountId },
    ])
    .onConflictDoNothing();

  console.log("seeded (production bootstrap):");
  console.log("  organization:", ORG);
  console.log("  domain:", MAIL_DOMAIN);
  console.log("  owner:", OWNER_USER_ID, "(" + OWNER_EMAIL + ")");
  console.log("  account:", TEST_ADDRESS, "(owner ramon-prod)");
  console.log("  mailboxes: Inbox, Sent, Drafts, Spam, Trash, Archive");
  console.log("  aliases: postmaster@ -> test@, abuse@ -> test@");
}

ensureSeed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });