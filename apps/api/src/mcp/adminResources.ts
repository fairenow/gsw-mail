import { and, eq } from "drizzle-orm";
import { requireOrgPermission } from "../auth/authorize.js";
import { db } from "../db/client.js";
import { domains, organizationMemberships, organizations } from "../db/schema.js";

/**
 * Administrative MCP discovery is scoped to active organization membership,
 * not possession of an email mailbox. Never infer workspace authority from
 * the OAuth token alone: roles are loaded from the product database.
 */
export function isActiveAdminMembership(row: {role: string; status: string}): boolean {
  return row.status === "active" && (row.role === "owner" || row.role === "admin");
}

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
  }).from(domains).where(eq(domains.organizationId, organizationId));
}
