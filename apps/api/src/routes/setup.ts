import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser } from "../auth/middleware.js";
import { db } from "../db/client.js";
import { domains, emailAccounts, organizationMemberships, organizations, workspaceSetupStates } from "../db/schema.js";
import { provisionDomainInfrastructure, verifyDomainInfrastructure } from "../lib/domainInfrastructure.js";
import { badRequest, notFound } from "../lib/errors.js";

const workspaceSchema = z.object({ name: z.string().trim().min(1).max(120) });
const DOMAIN_PATTERN = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

function normalizeDomainInput(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const raw = value.trim().toLowerCase();
  if (!raw) return raw;
  try {
    const parsed = new URL(raw.includes("://") ? raw : `https://${raw}`);
    return parsed.hostname.replace(/\.$/, "");
  } catch {
    return raw.replace(/^https?:\/\//, "").split("/")[0]?.replace(/\.$/, "") ?? raw;
  }
}

const domainSchema = z.object({ domain: z.preprocess(normalizeDomainInput, z.string().regex(DOMAIN_PATTERN, "Enter a domain like example.com")) });

export default async function setupRoutes(app: FastifyInstance) {
  await requireUser(app, { optional: false });

  async function workspaceFor(userId: string) {
    const [row] = await db
      .select({ id: organizations.id, name: organizations.name, role: organizationMemberships.role })
      .from(organizationMemberships)
      .innerJoin(organizations, eq(organizationMemberships.organizationId, organizations.id))
      .where(and(eq(organizationMemberships.userId, userId), eq(organizationMemberships.status, "active")))
      .limit(1);
    if (!row) throw notFound("workspace not found");
    return row;
  }

  app.get("/api/setup", async (req) => {
    const workspace = await workspaceFor(req.user!.id);
    const [setup] = await db.select().from(workspaceSetupStates).where(eq(workspaceSetupStates.organizationId, workspace.id)).limit(1);
    const domainRows = await db.select({ id: domains.id, name: domains.name, status: domains.status }).from(domains).where(eq(domains.organizationId, workspace.id)).limit(1);
    const domain = domainRows[0] ?? null;
    const mailboxRows = domain ? await db.select({ id: emailAccounts.id, address: emailAccounts.address }).from(emailAccounts).where(eq(emailAccounts.domainId, domain.id)).limit(1) : [];

    let currentStep = setup?.currentStep ?? "email_verified";
    if (domain && (currentStep === "email_verified" || currentStep === "workspace_created")) {
      currentStep = domain.status === "verified" ? "domain_verified" : "domain_added";
      await db.insert(workspaceSetupStates)
        .values({ organizationId: workspace.id, currentStep })
        .onConflictDoUpdate({ target: workspaceSetupStates.organizationId, set: { currentStep } });
    }

    return {
      workspace: { id: workspace.id, name: workspace.name, role: workspace.role },
      domain,
      mailbox: mailboxRows[0] ?? null,
      currentStep,
      onboardingComplete: currentStep === "complete",
      migratedFromExisting: setup?.migratedFromExisting ?? false,
    };
  });

  app.patch("/api/setup/workspace", async (req) => {
    const input = workspaceSchema.parse(req.body);
    const workspace = await workspaceFor(req.user!.id);
    if (workspace.role !== "owner" && workspace.role !== "admin") throw badRequest("workspace admin permission required");
    await db.update(organizations).set({ name: input.name }).where(eq(organizations.id, workspace.id));
    await db.insert(workspaceSetupStates).values({ organizationId: workspace.id, currentStep: "workspace_created" }).onConflictDoUpdate({ target: workspaceSetupStates.organizationId, set: { currentStep: "workspace_created" } });
    return { workspace: { ...workspace, name: input.name }, currentStep: "workspace_created" };
  });

  app.post("/api/setup/domain", async (req, reply) => {
    const input = domainSchema.parse(req.body);
    const workspace = await workspaceFor(req.user!.id);
    if (workspace.role !== "owner" && workspace.role !== "admin") throw badRequest("workspace admin permission required");
    const existing = await db.select({ id: domains.id, organizationId: domains.organizationId, name: domains.name, status: domains.status }).from(domains).where(eq(domains.name, input.domain)).limit(1);
    if (existing[0] && existing[0].organizationId !== workspace.id) throw badRequest("domain is already connected to another workspace");
    const [domain] = existing[0]
      ? [existing[0]]
      : await db.insert(domains).values({ organizationId: workspace.id, name: input.domain, status: "pending" }).returning({ id: domains.id, name: domains.name, status: domains.status });
    if (!domain) throw new Error("failed to create domain");

    await db.insert(workspaceSetupStates).values({ organizationId: workspace.id, currentStep: "domain_added" }).onConflictDoUpdate({ target: workspaceSetupStates.organizationId, set: { currentStep: "domain_added" } });

    try {
      await provisionDomainInfrastructure(domain.id, domain.name);
      const verification = await verifyDomainInfrastructure(domain.id, domain.name);
      await db.insert(workspaceSetupStates).values({ organizationId: workspace.id, currentStep: verification.healthy ? "domain_verified" : "domain_added" }).onConflictDoUpdate({ target: workspaceSetupStates.organizationId, set: { currentStep: verification.healthy ? "domain_verified" : "domain_added" } });
      reply.code(existing[0] ? 200 : 201);
      return { domain: { ...domain, status: verification.healthy ? "verified" : "pending" }, verification, currentStep: verification.healthy ? "domain_verified" : "domain_added" };
    } catch (error) {
      const infrastructureError = error instanceof Error ? error.message : "Mail infrastructure setup failed";
      req.log.error({ err: error, domainId: domain.id, domain: domain.name }, "domain was saved but infrastructure provisioning failed");
      reply.code(existing[0] ? 200 : 201);
      return {
        domain: { ...domain, status: "pending" as const },
        currentStep: "domain_added" as const,
        infrastructureError,
      };
    }
  });
}
