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
  authSetupStatus: string;
  role: (typeof accountMembershipRole.enumValues)[number];
  permissions: AccountPermission[];
  domainId: string;
  organizationId: string;
}

export async function getAccessibleAccounts(userId: string): Promise<AccessibleAccount[]> {
  const membershipRows = await db
    .select({
      account: emailAccounts,
      organizationId: emailAccounts.workspaceId,
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
      authSetupStatus: row.account.authSetupStatus,
      role: row.role,
      permissions: PERMISSIONS[row.role],
      domainId: row.account.domainId,
      organizationId: row.organizationId,
    });
  }

  if (config.env !== "production") {
    const ownedRows = await db
      .select({ account: emailAccounts, organizationId: emailAccounts.workspaceId })
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
        authSetupStatus: row.account.authSetupStatus,
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
  const [row] = await db
    .select({
      account: emailAccounts,
      organizationId: emailAccounts.workspaceId,
      role: mailAccountMemberships.role,
    })
    .from(emailAccounts)
    .innerJoin(domains, eq(emailAccounts.domainId, domains.id))
    .leftJoin(
      mailAccountMemberships,
      and(
        eq(mailAccountMemberships.accountId, emailAccounts.id),
        eq(mailAccountMemberships.userId, userId),
      ),
    )
    .where(eq(emailAccounts.id, accountId))
    .limit(1);

  const account = row?.account;
  if (!account) throw notFound("account not found");
  const role = row.role ?? (devOwnerFallback(account.userId, userId) ? "owner" : undefined);
  if (!role) throw forbidden();
  const permissions = PERMISSIONS[role];
  if (!permissions.includes(permission)) throw forbidden();

  return {
    id: account.id,
    address: account.address,
    displayName: account.displayName,
    status: account.status,
    authSetupStatus: account.authSetupStatus,
    role,
    permissions,
    domainId: account.domainId,
    organizationId: row.organizationId,
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

export async function resolveAdminOrg(userId: string, organizationId: string): Promise<string> {
  await requireOrgPermission(userId, organizationId, ["owner", "admin"]);
  return organizationId;
}
