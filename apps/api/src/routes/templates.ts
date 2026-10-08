import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser } from "../auth/middleware.js";
import { db } from "../db/client.js";
import { emailAccounts, mailAccountMemberships, userSettings } from "../db/schema.js";
import { MAIL_TEMPLATE_CATALOG } from "../mail/templates/index.js";
import {
  createCustomEmailTemplate,
  deleteCustomEmailTemplate,
  listCustomEmailTemplates,
  updateCustomEmailTemplate,
} from "../mail/templateService.js";
import { userHasBrandedTemplateAccess } from "../lib/templatePolicy.js";
import { notFound } from "../lib/errors.js";

const hex = z.string().regex(/^#[0-9a-f]{6}$/i);
const customTemplateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  borderColor: hex,
  fontColor: hex,
  buttonColor: hex,
  backgroundColor: hex,
  logoDataUrl: z.string().max(1_500_000).nullable().optional(),
  logoFilename: z.string().max(255).nullable().optional(),
  logoAssetId: z.string().uuid().nullable().optional(),
});
const customTemplatePatchSchema = customTemplateSchema.partial();
const selectionSchema = z.object({ templateKey: z.string().min(1).max(200) });

const builtInPresentation = {
  none: { editable: false, theme: null, logoUrl: null },
  gsw_default: {
    editable: false,
    theme: { borderColor: "#e89a12", fontColor: "#484640", buttonColor: "#e89a12", backgroundColor: "#f7f3ea" },
    logoUrl: "https://mail.guidedstepswellness.com/guided_steps_logo.png",
  },
  bible_reader: {
    editable: false,
    theme: { borderColor: "#e8e1d4", fontColor: "#484640", buttonColor: "#b98a45", backgroundColor: "#f8f6f0" },
    logoUrl: "https://mail.guidedstepswellness.com/bible_app.png",
  },
} as const;

export default async function templateRoutes(app: FastifyInstance) {
  await requireUser(app, { optional: false });

  app.get("/product/templates", async (req) => {
    const [accounts, custom, settings] = await Promise.all([
      db.select({ address: emailAccounts.address })
        .from(mailAccountMemberships)
        .innerJoin(emailAccounts, eq(mailAccountMemberships.accountId, emailAccounts.id))
        .where(eq(mailAccountMemberships.userId, req.user!.id)),
      listCustomEmailTemplates(req.user!.id),
      db.select({ general: userSettings.general }).from(userSettings).where(eq(userSettings.userId, req.user!.id)).limit(1),
    ]);
    const brandedAccess = userHasBrandedTemplateAccess(accounts.map((account) => account.address));
    const builtIns = (brandedAccess ? MAIL_TEMPLATE_CATALOG : MAIL_TEMPLATE_CATALOG.filter((template) => template.key === "none"))
      .map((template) => ({ ...template, kind: "builtin" as const, ...builtInPresentation[template.key] }));
    return {
      selectedTemplateKey: typeof settings[0]?.general?.templateKey === "string" ? settings[0].general.templateKey : "none",
      templates: [
        ...builtIns,
        ...custom.map((template) => ({
          ...template,
          kind: "custom" as const,
          editable: true,
          category: "custom",
          description: "Your custom GSW Mail template.",
          theme: {
            borderColor: template.borderColor,
            fontColor: template.fontColor,
            buttonColor: template.buttonColor,
            backgroundColor: template.backgroundColor,
          },
        })),
      ],
    };
  });

  app.post("/product/templates", async (req, reply) => {
    const input = customTemplateSchema.parse(req.body);
    const template = await createCustomEmailTemplate(req.user!.id, input);
    reply.code(201);
    return { template };
  });

  app.patch<{ Params: { id: string } }>("/product/templates/:id", async (req) => {
    const input = customTemplatePatchSchema.parse(req.body);
    return { template: await updateCustomEmailTemplate(req.user!.id, req.params.id, input) };
  });

  app.delete<{ Params: { id: string } }>("/product/templates/:id", async (req) => {
    const deleted = await deleteCustomEmailTemplate(req.user!.id, req.params.id);
    const [settings] = await db.select().from(userSettings).where(eq(userSettings.userId, req.user!.id)).limit(1);
    if (settings?.general?.templateKey === deleted.key) {
      await db.update(userSettings).set({ general: { ...settings.general, templateKey: "none" } }).where(eq(userSettings.userId, req.user!.id));
    }
    return { deleted };
  });

  app.post("/product/templates/select", async (req) => {
    const { templateKey } = selectionSchema.parse(req.body);
    const custom = (await listCustomEmailTemplates(req.user!.id)).find((template) => template.key === templateKey);
    const builtIn = MAIL_TEMPLATE_CATALOG.find((template) => template.key === templateKey);
    if (!custom && !builtIn) throw notFound("email template not found");

    const [current] = await db.select().from(userSettings).where(eq(userSettings.userId, req.user!.id)).limit(1);
    const general = { ...(current?.general ?? {}), templateKey };
    await db.insert(userSettings).values({
      userId: req.user!.id,
      general,
      compose: current?.compose ?? {},
      contacts: current?.contacts ?? {},
      ai: current?.ai ?? {},
    }).onConflictDoUpdate({ target: userSettings.userId, set: { general } });
    return { templateKey };
  });
}
