import { and, eq, inArray } from "drizzle-orm";
import { config } from "../config.js";
import { db } from "../db/client.js";
import {
  accountMembershipRole,
  domains,
  emailAccounts,
  mailAccountMemberships,
  organizationMemberships,
} from "../db/schema.js";
import { forbidden, notFound } from "../lib/errors.js";

export type AccountPermission = "read" | "send" | "manage";

const PERMISSIONS: Record<(typeof accountMembershipRole.enumValues)[number], AccountPermission[]> = {
  owner: ["read", "send", "manage"],
  delegate: ["read", "send"],
  read_only: ["read"],
};

const devOwnerFallback = (accountUserId: string | null, userId: string): boolean =>
  config.env !== "production" && accountUserId === userId;

export interface AccessibleAccount {
  id: string;
  address: string;
  displayName: string | null;
  status: string;
  role: (typeof accountMembershipRole.enumValues)[number];
  permissions: AccountPermission[];
  domainId: string;
  organizationId: string;
}

export async function getAccessibleAccounts(userId: string): Promise<AccessibleAccount[]> {
  const membershipRows = await db
    .select({
      account: emailAccounts,
      organizationId: domains.organizationId,
      role: mailAccountMemberships.role,
    })
    .from(mailAccountMemberships)
    .innerJoin(emailAccounts, eq(mailAccountMemberships.accountId, emailAccounts.id))
    .innerJoin(domains, eq(emailAccounts.domainId, domains.id))
    .where(eq(mailAccountMemberships.userId, userId));

  const byId = new Map<string, AccessibleAccount>();
  for (const row of membershipRows) {
    byId.set(row.account.id, {
      id: row.account.id,
      address: row.account.address,
      displayName: row.account.displayName,
      status: row.account.status,
      role: row.role,
      permissions: PERMISSIONS[row.role],
      domainId: row.account.domainId,
      organizationId: row.organizationId,
    });
  }

  if (config.env !== "production") {
    const ownedRows = await db
      .select({ account: emailAccounts, organizationId: domains.organizationId })
      .from(emailAccounts)
      .innerJoin(domains, eq(emailAccounts.domainId, domains.id))
      .where(eq(emailAccounts.userId, userId));
    for (const row of ownedRows) {
      if (byId.has(row.account.id)) continue;
      byId.set(row.account.id, {
        id: row.account.id,
        address: row.account.address,
        displayName: row.account.displayName,
        status: row.account.status,
        role: "owner",
        permissions: PERMISSIONS.owner,
        domainId: row.account.domainId,
        organizationId: row.organizationId,
      });
    }
  }

  return [...byId.values()];
}

export async function requireAccountPermission(
  userId: string,
  accountId: string,
  permission: AccountPermission,
): Promise<AccessibleAccount> {
  const accountRows = await db
    .select({ account: emailAccounts, organizationId: domains.organizationId })
    .from(emailAccounts)
    .innerJoin(domains, eq(emailAccounts.domainId, domains.id))
    .where(eq(emailAccounts.id, accountId))
    .limit(1);
  const account = accountRows[0]?.account;
  if (!account) throw notFound("account not found");
  const organizationId = accountRows[0]?.organizationId ?? "";

  const membershipRows = await db
    .select({ role: mailAccountMemberships.role })
    .from(mailAccountMemberships)
    .where(
      and(
        eq(mailAccountMemberships.accountId, accountId),
        eq(mailAccountMemberships.userId, userId),
      ),
    )
    .limit(1);
  const membershipRole = membershipRows[0]?.role;
  const role = membershipRole ?? (devOwnerFallback(account.userId, userId) ? "owner" : undefined);
  if (!role) throw forbidden();
  const permissions = PERMISSIONS[role];
  if (!permissions.includes(permission)) throw forbidden();

  return {
    id: account.id,
    address: account.address,
    displayName: account.displayName,
    status: account.status,
    role,
    permissions,
    domainId: account.domainId,
    organizationId,
  };
}

export type OrgRole = (typeof organizationMemberships.role.enumValues)[number];

export async function requireOrgPermission(userId: string, organizationId: string, roles: OrgRole[]): Promise<void> {
  const rows = await db
    .select({ role: organizationMemberships.role, status: organizationMemberships.status })
    .from(organizationMemberships)
    .where(
      and(
        eq(organizationMemberships.organizationId, organizationId),
        eq(organizationMemberships.userId, userId),
      ),
    )
    .limit(1);
  const membership = rows[0];
  if (!membership || membership.status !== "active") throw forbidden();
  if (!roles.includes(membership.role)) throw forbidden();
}

export async function requireOrgAdminAny(userId: string): Promise<string> {
  const rows = await db
    .select({ organizationId: organizationMemberships.organizationId, role: organizationMemberships.role })
    .from(organizationMemberships)
    .where(
      and(
        eq(organizationMemberships.userId, userId),
        eq(organizationMemberships.status, "active"),
        inArray(organizationMemberships.role, ["owner", "admin"]),
      ),
    )
    .limit(1);
  const orgId = rows[0]?.organizationId;
  if (!orgId) throw forbidden();
  return orgId;
}

export async function resolveAdminOrg(userId: string, organizationId?: string): Promise<string> {
  if (organizationId) {
    await requireOrgPermission(userId, organizationId, ["owner", "admin"]);
    return organizationId;
  }
  return requireOrgAdminAny(userId);
}