import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { requireUser } from "../auth/middleware.js";
import { db } from "../db/client.js";
import { emailAccounts, mailAccountMemberships } from "../db/schema.js";
import { MAIL_TEMPLATE_CATALOG } from "../mail/templates/index.js";
import { userHasBrandedTemplateAccess } from "../lib/templatePolicy.js";

export default async function templateRoutes(app: FastifyInstance) {
  await requireUser(app, { optional: false });

  app.get("/product/templates", async (req) => {
    const accounts = await db
      .select({ address: emailAccounts.address })
      .from(mailAccountMemberships)
      .innerJoin(emailAccounts, eq(mailAccountMemberships.accountId, emailAccounts.id))
      .where(eq(mailAccountMemberships.userId, req.user!.id));
    const brandedAccess = userHasBrandedTemplateAccess(accounts.map((account) => account.address));
    return {
      defaultTemplateKey: "none" as const,
      templates: brandedAccess
        ? MAIL_TEMPLATE_CATALOG
        : MAIL_TEMPLATE_CATALOG.filter((template) => template.key === "none"),
    };
  });
}
