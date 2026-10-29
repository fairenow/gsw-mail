import { domainDnsState } from "../db/domainDnsSchema.js";
import { and, eq } from "drizzle-orm";
import { requireOrgPermission } from "../auth/authorize.js";
import { isActiveAdminMembership } from "./adminPolicy.js";
import { db } from "../db/client.js";
import { domains, emailAccounts, organizationMemberships, organizations } from "../db/schema.js";

/**
 * Administrative MCP discovery is scoped to active organization membership,
 * not possession of an email mailbox. Never infer workspace authority from
 * the OAuth token alone: roles are loaded from the product database.
 */
export async function listMcpAdminWorkspaces(userId: string) {
  return db.select({
    organizationId: organizations.id,
    name: organizations.name,
    role: organizationMemberships.role,
    status: organizationMemberships.status,
  })
    .from(organizationMemberships)
    .innerJoin(organizations, eq(organizations.id, organizationMemberships.organizationId))
    .where(and(
      eq(organizationMemberships.userId, userId),
      eq(organizationMemberships.status, "active"),
    ))
    .then(rows => rows.filter(isActiveAdminMembership).map(({status: _status, ...row}) => row));
}

export async function listMcpAdminDomains(userId: string, organizationId: string) {
  await requireOrgPermission(userId, organizationId, ["owner", "admin"]);
  return db.select({
    domainId: domains.id,
    name: domains.name,
    status: domains.status,
    mxStatus: domains.mxStatus,
    spfStatus: domains.spfStatus,
    dkimStatus: domains.dkimStatus,
    dmarcStatus: domains.dmarcStatus,
    expectedRecords: domainDnsState.expectedRecords,
    observedRecords: domainDnsState.observedRecords,
    lastCheckedAt: domainDnsState.lastCheckedAt,
  }).from(domains).leftJoin(domainDnsState,eq(domainDnsState.domainId,domains.id)).where(eq(domains.organizationId, organizationId));
}

/** Inventory only: admin list never returns message bodies or mailbox credentials. */
export async function listMcpAdminMailboxes(userId: string, organizationId: string, domainId: string) {
  await requireOrgPermission(userId, organizationId, ["owner", "admin"]);
  const [domain] = await db.select({ id: domains.id, name: domains.name })
    .from(domains)
    .where(and(eq(domains.id, domainId), eq(domains.organizationId, organizationId)))
    .limit(1);
  if (!domain) throw new Error("domain_not_found");
  const mailboxes = await db.select({
    id: emailAccounts.id,
    address: emailAccounts.address,
    displayName: emailAccounts.displayName,
    status: emailAccounts.status,
    authSetupStatus: emailAccounts.authSetupStatus,
  }).from(emailAccounts).where(and(
    eq(emailAccounts.workspaceId, organizationId),
    eq(emailAccounts.domainId, domainId),
  ));
  return { organizationId, domainId, domain: domain.name, mailboxes };
}
