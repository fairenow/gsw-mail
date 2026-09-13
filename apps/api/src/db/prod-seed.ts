import { and, eq } from "drizzle-orm";
import { db } from "./client.js";
import { aliases, domains, emailAccounts, mailAccountMemberships, mailboxes, organizationMemberships, organizations, users } from "./schema.js";

const ORG = "Guided Steps Wellness";
const ORG_SLUG = "guided-steps-wellness";
const MAIL_DOMAIN = process.env.PROD_SEED_DOMAIN ?? "team.guidedstepswellness.com";
const OWNER_USER_ID = process.env.PROD_SEED_OWNER_ID;
const OWNER_IDENTITY_PROVIDER = process.env.PROD_SEED_IDENTITY_PROVIDER ?? "stalwart";
const OWNER_IDENTITY_SUBJECT = process.env.PROD_SEED_OWNER_SUBJECT;
const OWNER_EMAIL = process.env.PROD_SEED_OWNER_EMAIL;
const OWNER_NAME = process.env.PROD_SEED_OWNER_NAME;
const MAILBOX_LOCAL_PART = process.env.PROD_SEED_MAILBOX_LOCAL_PART;
const OWNER_ADDRESS = MAILBOX_LOCAL_PART ? `${MAILBOX_LOCAL_PART}@${MAIL_DOMAIN}` : undefined;
const MAILBOX_DISPLAY_NAME = process.env.PROD_SEED_MAILBOX_DISPLAY_NAME ?? OWNER_NAME;

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
    .values({ id, identityProvider: OWNER_IDENTITY_PROVIDER, identitySubject, email, emailVerified: true, name })
    .onConflictDoUpdate({
      target: users.id,
      set: { identityProvider: OWNER_IDENTITY_PROVIDER, identitySubject, email, emailVerified: true, name },
    });
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

  const ownerFields = [OWNER_USER_ID, OWNER_IDENTITY_SUBJECT, OWNER_EMAIL, OWNER_NAME, MAILBOX_LOCAL_PART].every(Boolean);
  if (ownerFields && OWNER_USER_ID && OWNER_IDENTITY_SUBJECT && OWNER_EMAIL && OWNER_NAME && MAILBOX_LOCAL_PART && OWNER_ADDRESS) {
    const ownerUserId = await ensureUser(OWNER_USER_ID, OWNER_IDENTITY_SUBJECT, OWNER_EMAIL, OWNER_NAME);
    await ensureOrgMembership(organizationId, ownerUserId, "owner");

    const ownerAccountId = await ensureAccount(domainId, MAILBOX_LOCAL_PART, OWNER_ADDRESS, MAILBOX_DISPLAY_NAME ?? OWNER_NAME, ownerUserId);
    await ensureMembership(ownerAccountId, ownerUserId, "owner");

    await db
      .insert(aliases)
      .values([
        { domainId, source: "postmaster", targetAccountId: ownerAccountId },
        { domainId, source: "abuse", targetAccountId: ownerAccountId },
      ])
      .onConflictDoUpdate({ target: [aliases.domainId, aliases.source], set: { targetAccountId: ownerAccountId } });
  } else if ([OWNER_USER_ID, OWNER_IDENTITY_SUBJECT, OWNER_EMAIL, OWNER_NAME, MAILBOX_LOCAL_PART].some(Boolean)) {
    throw new Error("PROD_SEED_OWNER_ID, PROD_SEED_OWNER_SUBJECT, PROD_SEED_OWNER_EMAIL, PROD_SEED_OWNER_NAME, and PROD_SEED_MAILBOX_LOCAL_PART must be set together");
  }

  console.log("seeded (production bootstrap):");
  console.log("  organization:", ORG);
  console.log("  domain:", MAIL_DOMAIN);
  console.log("  owner bootstrap:", ownerFields ? OWNER_USER_ID : "not configured; provision on login or run db:backfill:prod");
}

ensureSeed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
