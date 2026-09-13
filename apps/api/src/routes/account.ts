import { eq, inArray } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { requireUser } from "../auth/middleware.js";
import { db } from "../db/client.js";
import { domains, emailAccounts, mailAccountMemberships, organizationMemberships, organizations, users, workspaceSetupStates } from "../db/schema.js";

export default async function accountRoutes(app: FastifyInstance) {
  await requireUser(app, { optional: false });

  app.get("/api/account/context", async (req) => {
    const userId = req.user!.id;
    const workspaces = await db
      .select({ id: organizations.id, name: organizations.name, role: organizationMemberships.role, status: organizationMemberships.status, setupStep: workspaceSetupStates.currentStep, migratedFromExisting: workspaceSetupStates.migratedFromExisting })
      .from(organizationMemberships)
      .innerJoin(organizations, eq(organizationMemberships.organizationId, organizations.id))
      .leftJoin(workspaceSetupStates, eq(workspaceSetupStates.organizationId, organizations.id))
      .where(eq(organizationMemberships.userId, userId));
    const mailboxMemberships = await db
      .select({ id: emailAccounts.id, address: emailAccounts.address, displayName: emailAccounts.displayName, role: mailAccountMemberships.role, workspaceId: emailAccounts.workspaceId, workspaceName: organizations.name, domain: domains.name })
      .from(mailAccountMemberships)
      .innerJoin(emailAccounts, eq(mailAccountMemberships.accountId, emailAccounts.id))
      .innerJoin(organizations, eq(emailAccounts.workspaceId, organizations.id))
      .innerJoin(domains, eq(emailAccounts.domainId, domains.id))
      .where(eq(mailAccountMemberships.userId, userId));
    const workspaceAdmin = workspaces.some((workspace) => workspace.status === "active" && (workspace.role === "owner" || workspace.role === "admin"));
    const mailboxUser = mailboxMemberships.length > 0;
    const incomplete = workspaces.some((workspace) => workspace.status === "active" && workspace.setupStep !== "complete");
    const defaultDestination = incomplete && !mailboxUser ? "setup" : workspaceAdmin ? "control-center" : mailboxUser ? "mail" : "setup";
    const managedMailboxes = workspaceAdmin && workspaces.length > 0
      ? await db.select({ id: emailAccounts.id, address: emailAccounts.address, displayName: emailAccounts.displayName, workspaceId: emailAccounts.workspaceId, authUserId: users.authUserId, status: emailAccounts.status }).from(emailAccounts).innerJoin(users, eq(emailAccounts.userId, users.id)).where(inArray(emailAccounts.workspaceId, workspaces.map((workspace) => workspace.id)))
      : [];
    return {
      user: { id: userId, email: req.user!.email ?? null },
      workspaceMemberships: workspaces,
      mailboxMemberships,
      managedMailboxes,
      onboardingComplete: workspaces.length > 0 && workspaces.every((workspace) => workspace.setupStep === "complete"),
      defaultDestination,
    };
  });
}
