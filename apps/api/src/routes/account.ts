import { and, eq, inArray } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { conflict } from "../lib/errors.js";
import { requireUser } from "../auth/middleware.js";
import { db } from "../db/client.js";
import { contacts, domains, emailAccounts, emailSignatures, mailAccountMemberships, organizationMemberships, organizations, userSettings, users, workspaceSetupStates } from "../db/schema.js";

export default async function accountRoutes(app: FastifyInstance) {
  await requireUser(app, { optional: false });

  app.get("/api/account/diagnostics", async (req) => {
    const userId = req.user!.id;
    const [productUser] = await db.select({ id: users.id, email: users.email, authUserId: users.authUserId, status: users.status }).from(users).where(eq(users.id, userId)).limit(1);
    const ownedMailboxes = await db.select({ id: emailAccounts.id, address: emailAccounts.address, status: emailAccounts.status, authSetupStatus: emailAccounts.authSetupStatus }).from(emailAccounts).where(eq(emailAccounts.userId, userId));
    const mailboxMemberships = await db
      .select({ accountId: mailAccountMemberships.accountId, role: mailAccountMemberships.role, authUserId: mailAccountMemberships.authUserId, address: emailAccounts.address, status: emailAccounts.status, authSetupStatus: emailAccounts.authSetupStatus })
      .from(mailAccountMemberships)
      .innerJoin(emailAccounts, eq(mailAccountMemberships.accountId, emailAccounts.id))
      .where(eq(mailAccountMemberships.userId, userId));
    const workspaceMemberships = await db.select({ organizationId: organizationMemberships.organizationId, role: organizationMemberships.role, status: organizationMemberships.status }).from(organizationMemberships).where(eq(organizationMemberships.userId, userId));
    const contactRows = await db.select({ id: contacts.id }).from(contacts).where(eq(contacts.ownerUserId, userId));
    const [settings] = await db.select({ userId: userSettings.userId }).from(userSettings).where(eq(userSettings.userId, userId)).limit(1);
    const [signature] = await db.select({ userId: emailSignatures.userId }).from(emailSignatures).where(eq(emailSignatures.userId, userId)).limit(1);

    const diagnostics = {
      authenticated: true,
      authUserId: req.authUserId ?? null,
      productUser: productUser ?? null,
      counts: {
        ownedMailboxes: ownedMailboxes.length,
        mailboxMemberships: mailboxMemberships.length,
        workspaceMemberships: workspaceMemberships.length,
        contacts: contactRows.length,
      },
      ownedMailboxes,
      mailboxMemberships,
      workspaceMemberships,
      hasSettings: Boolean(settings),
      hasSignature: Boolean(signature),
    };

    req.log.info({
      authUserId: diagnostics.authUserId,
      userId,
      ...diagnostics.counts,
      hasSettings: diagnostics.hasSettings,
      hasSignature: diagnostics.hasSignature,
    }, "account linkage diagnostics resolved");

    return diagnostics;
  });

  app.get("/api/account/context", async (req) => {
    const startedAt = Date.now();
    const userId = req.user!.id;
    const [productUser] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!productUser || productUser.status !== "active") throw conflict("Account linkage unavailable");
    if (!productUser.authUserId) throw conflict("Account linkage unavailable");
    await db.transaction(async (tx) => {
      const owned = await tx.select({ id: emailAccounts.id, workspaceId: emailAccounts.workspaceId, status: emailAccounts.status, authSetupStatus: emailAccounts.authSetupStatus }).from(emailAccounts).where(eq(emailAccounts.userId, userId));
      for (const mailbox of owned) {
        if (mailbox.status !== "active" || mailbox.authSetupStatus !== "ready") continue;
        await tx.insert(mailAccountMemberships).values({ accountId: mailbox.id, userId, authUserId: productUser.authUserId!, role: "owner" }).onConflictDoUpdate({ target: [mailAccountMemberships.accountId, mailAccountMemberships.userId], set: { authUserId: productUser.authUserId!, role: "owner" } });
      }
      await tx.update(mailAccountMemberships).set({ authUserId: productUser.authUserId! }).where(eq(mailAccountMemberships.userId, userId));
    });
    const workspaces = await db
      .select({ id: organizations.id, name: organizations.name, role: organizationMemberships.role, status: organizationMemberships.status, setupStep: workspaceSetupStates.currentStep, migratedFromExisting: workspaceSetupStates.migratedFromExisting })
      .from(organizationMemberships)
      .innerJoin(organizations, eq(organizationMemberships.organizationId, organizations.id))
      .leftJoin(workspaceSetupStates, eq(workspaceSetupStates.organizationId, organizations.id))
      .where(eq(organizationMemberships.userId, userId));
    const mailboxMemberships = await db
      .select({ id: emailAccounts.id, address: emailAccounts.address, displayName: emailAccounts.displayName, role: mailAccountMemberships.role, workspaceId: emailAccounts.workspaceId, workspaceName: organizations.name, domain: domains.name, authSetupStatus: emailAccounts.authSetupStatus, status: emailAccounts.status, membershipAuthUserId: mailAccountMemberships.authUserId })
      .from(mailAccountMemberships)
      .innerJoin(emailAccounts, eq(mailAccountMemberships.accountId, emailAccounts.id))
      .innerJoin(organizations, eq(emailAccounts.workspaceId, organizations.id))
      .innerJoin(domains, and(eq(emailAccounts.domainId, domains.id), eq(emailAccounts.workspaceId, domains.organizationId)))
      .where(eq(mailAccountMemberships.userId, userId));
    const ownedMailboxes = await db.select({ id: emailAccounts.id }).from(emailAccounts).where(eq(emailAccounts.userId, userId));
    if (ownedMailboxes.some((account) => !mailboxMemberships.some((membership) => membership.id === account.id))) throw conflict("Mailbox membership unavailable");
    const membershipCount = await db.select({ id: mailAccountMemberships.accountId }).from(mailAccountMemberships).where(eq(mailAccountMemberships.userId, userId));
    if (membershipCount.length !== mailboxMemberships.length || mailboxMemberships.some((mailbox) => mailbox.authSetupStatus !== "ready" || mailbox.status !== "active" || mailbox.membershipAuthUserId !== productUser.authUserId || !workspaces.some((workspace) => workspace.id === mailbox.workspaceId && workspace.status === "active"))) throw conflict("Your login is ready, but we couldn't connect it to your mailbox.");
    const workspaceAdmin = workspaces.some((workspace) => workspace.status === "active" && (workspace.role === "owner" || workspace.role === "admin"));
    const mailboxUser = mailboxMemberships.length > 0;
    const incomplete = workspaces.some((workspace) => workspace.status === "active" && workspace.setupStep !== "complete");
    const defaultDestination = incomplete && !mailboxUser ? "setup" : workspaceAdmin ? "control-center" : mailboxUser ? "mail" : "setup";
    const managedMailboxes = workspaceAdmin && workspaces.length > 0
      ? await db.select({ id: emailAccounts.id, address: emailAccounts.address, displayName: emailAccounts.displayName, workspaceId: emailAccounts.workspaceId, authUserId: users.authUserId, authSetupStatus: emailAccounts.authSetupStatus, status: emailAccounts.status }).from(emailAccounts).innerJoin(users, eq(emailAccounts.userId, users.id)).where(inArray(emailAccounts.workspaceId, workspaces.filter((workspace) => workspace.status === "active" && (workspace.role === "owner" || workspace.role === "admin")).map((workspace) => workspace.id)))
      : [];
    req.log.info({ userId, authUserId: productUser.authUserId, mailboxCount: mailboxMemberships.length, workspaceCount: workspaces.length, defaultDestination, durationMs: Date.now() - startedAt }, "account context resolved");
    return {
      resolved: true,
      authUserId: productUser.authUserId,
      user: { id: userId, email: req.user!.email ?? null },
      workspaceMemberships: workspaces,
      mailboxMemberships,
      managedMailboxes,
      onboardingComplete: workspaces.length > 0 && workspaces.every((workspace) => workspace.setupStep === "complete"),
      defaultDestination,
    };
  });
}
