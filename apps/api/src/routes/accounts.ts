import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getAccessibleAccounts, requireAccountPermission, requireOrgPermission } from "../auth/authorize.js";
import { requireUser } from "../auth/middleware.js";
import { db } from "../db/client.js";
import { domains, emailAccounts, mailAccountMemberships, mailboxes, users } from "../db/schema.js";
import { getEngine } from "../engine/index.js";
import { audit } from "../lib/audit.js";
import { badRequest, notFound } from "../lib/errors.js";

interface Params {
  id: string;
}

interface DelegateParams {
  id: string;
  userId: string;
}

const accountColumns = {
  id: emailAccounts.id,
  address: emailAccounts.address,
  displayName: emailAccounts.displayName,
  domain: domains.name,
  status: emailAccounts.status,
  quotaBytes: emailAccounts.quotaBytes,
  usedBytes: emailAccounts.usedBytes,
  createdAt: emailAccounts.createdAt,
};

const createAccountSchema = z.object({
  organizationId: z.string().uuid(),
  domainId: z.string().uuid(),
  localPart: z.string().trim().regex(/^[a-z0-9._%+-]+$/i),
  displayName: z.string().trim().optional(),
  quotaBytes: z.number().int().positive().optional(),
  ownerUserId: z.string().uuid().optional(),
});

const updateAccountSchema = z.object({
  organizationId: z.string().uuid(),
  status: z.enum(["pending", "active", "disabled"]).optional(),
  displayName: z.string().optional(),
  quotaBytes: z.number().int().positive().optional(),
});

const addDelegateSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(["delegate", "read_only"]).optional(),
});

export default async (app: FastifyInstance) => {
  await requireUser(app, { optional: false });
  const engine = getEngine();

  app.get("/mail/accounts", async (req) => {
    const accounts = await getAccessibleAccounts(req.user!.id);
    return {
      accounts: accounts.map((a) => ({
        id: a.id,
        address: a.address,
        displayName: a.displayName,
        status: a.status,
        role: a.role,
        permissions: a.permissions,
        organizationId: a.organizationId,
      })),
    };
  });

  app.get<{ Params: Params }>("/mail/accounts/:id", async (req) => {
    await requireAccountPermission(req.user!.id, req.params.id, "read");
    const rows = await db
      .select(accountColumns)
      .from(emailAccounts)
      .innerJoin(domains, eq(emailAccounts.domainId, domains.id))
      .where(eq(emailAccounts.id, req.params.id))
      .limit(1);
    const found = rows[0];
    if (!found) throw notFound("account not found");
    return found;
  });

  app.get<{ Params: Params }>("/mail/accounts/:id/mailboxes", async (req) => {
    await requireAccountPermission(req.user!.id, req.params.id, "read");
    return { mailboxes: await engine.listMailboxes(req.params.id) };
  });

  app.post("/mail/accounts", async (req, reply) => {
    const input = createAccountSchema.parse(req.body);
    const orgId = input.organizationId;
    await requireOrgPermission(req.user!.id, orgId, ["owner", "admin"]);
    const domainRow = await db
      .select({ id: domains.id, name: domains.name, organizationId: domains.organizationId })
      .from(domains)
      .where(eq(domains.id, input.domainId))
      .limit(1);
    const domain = domainRow[0];
    if (!domain) throw notFound("domain not found");
    if (domain.organizationId !== orgId) throw badRequest("domain does not belong to your organization");
    if (input.ownerUserId) {
      const [owner] = await db.select({ id: users.id }).from(users).where(eq(users.id, input.ownerUserId)).limit(1);
      if (!owner) throw badRequest("ownerUserId must reference an existing user");
    }
    const address = `${input.localPart}@${domain.name}`;

    const account = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(emailAccounts)
        .values({
          domainId: input.domainId,
          userId: input.ownerUserId,
          localPart: input.localPart,
          address,
          displayName: input.displayName,
          quotaBytes: input.quotaBytes,
        })
        .returning();
      if (!created) throw new Error("failed to create account");
      await tx.insert(mailboxes).values([
        { accountId: created.id, role: "inbox", engineName: "Inbox" },
        { accountId: created.id, role: "sent", engineName: "Sent" },
        { accountId: created.id, role: "drafts", engineName: "Drafts" },
        { accountId: created.id, role: "spam", engineName: "Spam" },
        { accountId: created.id, role: "trash", engineName: "Trash" },
        { accountId: created.id, role: "archive", engineName: "Archive" },
      ]);
      await tx.insert(mailAccountMemberships).values({
        accountId: created.id,
        userId: input.ownerUserId ?? req.user!.id,
        role: "owner",
      });
      return created;
    });

    await audit({
      actorUserId: req.user!.id,
      organizationId: orgId,
      action: "account.created",
      resourceType: "email_account",
      resourceId: account.id,
      metadata: { address },
      request: req,
    });
    reply.code(201);
    return account;
  });

  app.patch<{ Params: Params }>("/mail/accounts/:id", async (req, reply) => {
    const input = updateAccountSchema.parse(req.body);
    const [row] = await db
      .select({ organizationId: domains.organizationId })
      .from(emailAccounts)
      .innerJoin(domains, eq(emailAccounts.domainId, domains.id))
      .where(eq(emailAccounts.id, req.params.id))
      .limit(1);
    if (!row) throw notFound("account not found");
    await requireOrgPermission(req.user!.id, input.organizationId, ["owner", "admin"]);
    if (row.organizationId !== input.organizationId) throw notFound("account not found");
    const [updated] = await db
      .update(emailAccounts)
      .set({ status: input.status, displayName: input.displayName, quotaBytes: input.quotaBytes })
      .where(eq(emailAccounts.id, req.params.id))
      .returning();
    if (!updated) throw notFound("account not found");
    await audit({
      actorUserId: req.user!.id,
      organizationId: row.organizationId,
      action: "account.updated",
      resourceType: "email_account",
      resourceId: updated.id,
      metadata: input,
      request: req,
    });
    return updated;
  });

  app.post<{ Params: Params }>("/mail/accounts/:id/delegates", async (req, reply) => {
    const input = addDelegateSchema.parse(req.body);
    const account = await requireAccountPermission(req.user!.id, req.params.id, "manage");
    const [target] = await db.select({ id: users.id }).from(users).where(eq(users.id, input.userId)).limit(1);
    if (!target) throw notFound("user not found");
    const inserted = await db
      .insert(mailAccountMemberships)
      .values({ accountId: req.params.id, userId: input.userId, role: input.role ?? "delegate" })
      .onConflictDoNothing()
      .returning({ id: mailAccountMemberships.id });
    if (inserted.length === 0) {
      await requireAccountPermission(req.user!.id, req.params.id, "read");
      throw badRequest("membership already exists for this user");
    }
    const membershipId = inserted[0]!.id;
    await audit({
      actorUserId: req.user!.id,
      organizationId: account.organizationId,
      action: "account.delegate_added",
      resourceType: "mail_account_membership",
      resourceId: membershipId,
      metadata: { userId: input.userId, role: input.role ?? "delegate", accountId: req.params.id, address: account.address },
      request: req,
    });
    reply.code(201);
    return { accountId: req.params.id, userId: input.userId, role: input.role ?? "delegate" };
  });

  app.delete<{ Params: DelegateParams }>("/mail/accounts/:id/delegates/:userId", async (req) => {
    const account = await requireAccountPermission(req.user!.id, req.params.id, "manage");
    const [existing] = await db
      .select({ id: mailAccountMemberships.id, role: mailAccountMemberships.role })
      .from(mailAccountMemberships)
      .where(and(eq(mailAccountMemberships.accountId, req.params.id), eq(mailAccountMemberships.userId, req.params.userId)))
      .limit(1);
    if (!existing) throw notFound("membership not found");
    if (existing.role === "owner") throw badRequest("owner membership cannot be removed through the delegate endpoint");
    await db.delete(mailAccountMemberships).where(eq(mailAccountMemberships.id, existing.id));
    await audit({
      actorUserId: req.user!.id,
      organizationId: account.organizationId,
      action: "account.delegate_removed",
      resourceType: "mail_account_membership",
      resourceId: existing.id,
      metadata: { userId: req.params.userId, accountId: req.params.id, address: account.address },
      request: req,
    });
    return { accountId: req.params.id, userId: req.params.userId, removed: true };
  });
};