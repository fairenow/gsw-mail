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

interface CachedAccessibleAccount {
  account: AccessibleAccount;
  expiresAt: number;
}

const permissionCache = new Map<string, CachedAccessibleAccount>();
const permissionInFlight = new Map<string, Promise<AccessibleAccount>>();
const PERMISSION_CACHE_TTL_MS = 60_000;

const permissionCacheKey = (userId: string, accountId: string) => `${userId}:${accountId}`;

const trimPermissionCache = () => {
  const now = Date.now();
  for (const [key, value] of permissionCache) if (value.expiresAt <= now) permissionCache.delete(key);
  if (permissionCache.size > 1024) permissionCache.delete(permissionCache.keys().next().value!);
};

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
    const account: AccessibleAccount = {
      id: row.account.id,
      address: row.account.address,
      displayName: row.account.displayName,
      status: row.account.status,
      authSetupStatus: row.account.authSetupStatus,
      role: row.role,
      permissions: PERMISSIONS[row.role],
      domainId: row.account.domainId,
      organizationId: row.organizationId,
    };
    byId.set(row.account.id, account);
    permissionCache.set(permissionCacheKey(userId, row.account.id), { account, expiresAt: Date.now() + PERMISSION_CACHE_TTL_MS });
  }

  if (config.env !== "production") {
    const ownedRows = await db
      .select({ account: emailAccounts, organizationId: emailAccounts.workspaceId })
      .from(emailAccounts)
      .innerJoin(domains, eq(emailAccounts.domainId, domains.id))
      .where(eq(emailAccounts.userId, userId));
    for (const row of ownedRows) {
      if (byId.has(row.account.id)) continue;
      const account: AccessibleAccount = {
        id: row.account.id,
        address: row.account.address,
        displayName: row.account.displayName,
        status: row.account.status,
        authSetupStatus: row.account.authSetupStatus,
        role: "owner",
        permissions: PERMISSIONS.owner,
        domainId: row.account.domainId,
        organizationId: row.organizationId,
      };
      byId.set(row.account.id, account);
      permissionCache.set(permissionCacheKey(userId, row.account.id), { account, expiresAt: Date.now() + PERMISSION_CACHE_TTL_MS });
    }
  }

  trimPermissionCache();
  return [...byId.values()];
}

const loadAccessibleAccount = async (userId: string, accountId: string): Promise<AccessibleAccount> => {
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
  return {
    id: account.id,
    address: account.address,
    displayName: account.displayName,
    status: account.status,
    authSetupStatus: account.authSetupStatus,
    role,
    permissions: PERMISSIONS[role],
    domainId: account.domainId,
    organizationId: row.organizationId,
  };
};

export async function requireAccountPermission(
  userId: string,
  accountId: string,
  permission: AccountPermission,
): Promise<AccessibleAccount> {
  const key = permissionCacheKey(userId, accountId);
  const cached = permissionCache.get(key);
  let account: AccessibleAccount;
  if (cached && cached.expiresAt > Date.now()) {
    account = cached.account;
  } else {
    if (cached) permissionCache.delete(key);
    const existing = permissionInFlight.get(key);
    const pending = existing ?? loadAccessibleAccount(userId, accountId);
    if (!existing) permissionInFlight.set(key, pending);
    try {
      account = await pending;
      permissionCache.set(key, { account, expiresAt: Date.now() + PERMISSION_CACHE_TTL_MS });
      trimPermissionCache();
    } finally {
      if (permissionInFlight.get(key) === pending) permissionInFlight.delete(key);
    }
  }
  if (!account.permissions.includes(permission)) throw forbidden();
  return account;
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
