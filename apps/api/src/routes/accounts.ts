import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { z } from "zod";
import { requireAdmin, requireUser } from "../auth/middleware.js";
import { db } from "../db/client.js";
import { domains, emailAccounts, mailboxes, users } from "../db/schema.js";
import { getEngine } from "../engine/index.js";
import { notFound } from "../lib/errors.js";

interface Params {
  id: string;
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
  domainId: z.string().uuid(),
  userId: z.string().optional(),
  localPart: z.string().trim().regex(/^[a-z0-9._%+-]+$/i),
  displayName: z.string().trim().optional(),
  quotaBytes: z.number().int().positive().optional(),
});

const updateAccountSchema = z.object({
  status: z.enum(["pending", "active", "disabled"]).optional(),
  displayName: z.string().optional(),
  quotaBytes: z.number().int().positive().optional(),
});

export default fp(async (app: FastifyInstance) => {
  app.register(requireUser, { optional: false });
  const engine = getEngine();

  app.get("/mail/accounts", async (req) => {
    const rows = await db
      .select(accountColumns)
      .from(emailAccounts)
      .innerJoin(domains, eq(emailAccounts.domainId, domains.id))
      .where(eq(emailAccounts.userId, req.user!.id))
      .orderBy(emailAccounts.createdAt);
    return { accounts: rows };
  });

  app.get<{ Params: Params }>("/mail/accounts/:id", async (req, reply) => {
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
    await requireAccount(req.params.id);
    return { mailboxes: await engine.listMailboxes(req.params.id) };
  });

  app.post("/mail/accounts", { preHandler: requireAdmin }, async (req, reply) => {
    const input = createAccountSchema.parse(req.body);
    const rows = await db.select({ name: domains.name }).from(domains).where(eq(domains.id, input.domainId)).limit(1);
    const domain = rows[0];
    if (!domain) throw notFound("domain not found");
    const address = `${input.localPart}@${domain.name}`;

    const account = await db.transaction(async (tx) => {
      const owner = input.userId ? await tx.select({ id: users.id }).from(users).where(eq(users.id, input.userId)).limit(1) : [];
      const [created] = await tx
        .insert(emailAccounts)
        .values({
          domainId: input.domainId,
          userId: owner[0]?.id,
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
      return created;
    });

    reply.code(201);
    return account;
  });

  app.patch<{ Params: Params }>("/mail/accounts/:id", { preHandler: requireAdmin }, async ({ params, body }) => {
    const input = updateAccountSchema.parse(body);
    const [updated] = await db
      .update(emailAccounts)
      .set(input)
      .where(eq(emailAccounts.id, params.id))
      .returning();
    if (!updated) throw notFound("account not found");
    return updated;
  });

  async function requireAccount(accountId: string) {
    const [account] = await db.select().from(emailAccounts).where(eq(emailAccounts.id, accountId)).limit(1);
    if (!account) throw notFound("account not found");
    return account;
  }
});