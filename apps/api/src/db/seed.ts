import { eq } from "drizzle-orm";
import { db } from "./client.js";
import { aliases, domains, emailAccounts, mailboxes, organizations, users } from "./schema.js";

const ORG = "Guided Steps Wellness";
const DOMAIN = "guidedstepswellness.com";

async function ensureSeed() {
  const [org] = await db.insert(organizations).values({ name: ORG, slug: "guided-steps-wellness" }).onConflictDoNothing().returning();

  const organizationId = org?.id ?? (await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.slug, "guided-steps-wellness")).limit(1))[0]!.id;

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

  await db
    .insert(users)
    .values({ id: "dev-user", email: "ramon@guidedstepswellness.com", name: "Ramon Williams" })
    .onConflictDoNothing()
    .returning();

  const [account] = await db
    .insert(emailAccounts)
    .values({
      domainId,
      userId: "dev-user",
      localPart: "ramon",
      address: "ramon@guidedstepswellness.com",
      displayName: "Ramon Williams",
      status: "active",
      quotaBytes: 5_000_000_000,
    })
    .onConflictDoNothing({ target: emailAccounts.address })
    .returning();

  const accountId = account?.id ?? (await db.select({ id: emailAccounts.id }).from(emailAccounts).where(eq(emailAccounts.address, "ramon@guidedstepswellness.com")).limit(1))[0]!.id;

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

  await db
    .insert(aliases)
    .values({ domainId, source: "hello", targetAccountId: accountId })
    .onConflictDoNothing();

  console.log("seeded:");
  console.log("  organization:", ORG);
  console.log("  domain:", DOMAIN);
  console.log("  account: ramon@guidedstepswellness.com");
  console.log("  mailboxes: Inbox, Sent, Drafts, Spam, Trash, Archive");
}

ensureSeed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });