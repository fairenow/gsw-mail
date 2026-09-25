import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireOrgPermission } from "../auth/authorize.js";
import { requireUser } from "../auth/middleware.js";
import { db } from "../db/client.js";
import { domainDnsState } from "../db/domainDnsSchema.js";
import { domains } from "../db/schema.js";
import { provisionDomainInfrastructure, verifyDomainInfrastructure } from "../lib/domainInfrastructure.js";
import { badRequest, notFound } from "../lib/errors.js";

const domainName = z.string().trim().toLowerCase().regex(/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/);
const orgQuery = z.object({ organizationId: z.string().uuid() });
const addDomainBody = z.object({ organizationId: z.string().uuid(), domain: domainName });

export default async function domainAdminRoutes(app: FastifyInstance) {
  await requireUser(app, { optional: false });

  app.get("/admin/domains", async (req) => {
    const { organizationId } = orgQuery.parse(req.query ?? {});
    await requireOrgPermission(req.user!.id, organizationId, ["owner", "admin"]);
    const rows = await db
      .select({
        id: domains.id,
        name: domains.name,
        status: domains.status,
        mxStatus: domains.mxStatus,
        spfStatus: domains.spfStatus,
        dkimStatus: domains.dkimStatus,
        dmarcStatus: domains.dmarcStatus,
        dkimSelector: domains.dkimSelector,
        updatedAt: domains.updatedAt,
        stalwartDomainId: domainDnsState.stalwartDomainId,
        stalwartDnsZoneFile: domainDnsState.stalwartDnsZoneFile,
        resendDomainId: domainDnsState.resendDomainId,
        expectedRecords: domainDnsState.expectedRecords,
        observedRecords: domainDnsState.observedRecords,
        lastCheckedAt: domainDnsState.lastCheckedAt,
        lastHealthyAt: domainDnsState.lastHealthyAt,
        lastError: domainDnsState.lastError,
      })
      .from(domains)
      .leftJoin(domainDnsState, eq(domainDnsState.domainId, domains.id))
      .where(eq(domains.organizationId, organizationId));
    return { organizationId, domains: rows };
  });

  app.post("/admin/domains", async (req, reply) => {
    const input = addDomainBody.parse(req.body ?? {});
    await requireOrgPermission(req.user!.id, input.organizationId, ["owner", "admin"]);
    const [existing] = await db.select({ id: domains.id, organizationId: domains.organizationId, name: domains.name }).from(domains).where(eq(domains.name, input.domain)).limit(1);
    if (existing && existing.organizationId !== input.organizationId) throw badRequest("domain is already connected to another workspace");
    const [domain] = existing
      ? [existing]
      : await db.insert(domains).values({ organizationId: input.organizationId, name: input.domain, status: "pending" }).returning({ id: domains.id, organizationId: domains.organizationId, name: domains.name });
    if (!domain) throw new Error("failed to create domain");
    const infrastructure = await provisionDomainInfrastructure(domain.id, domain.name);
    const verification = await verifyDomainInfrastructure(domain.id, domain.name);
    reply.code(existing ? 200 : 201);
    return { domainId: domain.id, name: domain.name, infrastructure, verification };
  });

  app.post<{ Params: { id: string } }>("/admin/domains/:id/verify", async (req) => {
    const [domain] = await db.select({ id: domains.id, name: domains.name, organizationId: domains.organizationId }).from(domains).where(eq(domains.id, req.params.id)).limit(1);
    if (!domain) throw notFound("domain not found");
    await requireOrgPermission(req.user!.id, domain.organizationId, ["owner", "admin"]);
    return verifyDomainInfrastructure(domain.id, domain.name);
  });
}
