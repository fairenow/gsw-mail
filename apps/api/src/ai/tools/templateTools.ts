import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client.js";
import { userSettings } from "../../db/schema.js";
import {
  createCustomEmailTemplate,
  getCustomEmailTemplate,
  listCustomEmailTemplates,
  updateCustomEmailTemplate,
} from "../../mail/templateService.js";
import { MAIL_TEMPLATE_CATALOG } from "../../mail/templates/index.js";
import type { AgentExecutionContext, AgentToolDefinition, AgentToolResult } from "./types.js";

const success = <T>(ctx: AgentExecutionContext, toolCallId: string, startedAt: string, data: T): AgentToolResult<T> => ({
  ok: true,
  toolCallId,
  data,
  audit: { userId: ctx.userId, accountId: ctx.accountId, startedAt, completedAt: new Date().toISOString() },
});
const failure = (ctx: AgentExecutionContext, toolCallId: string, startedAt: string, error: unknown): AgentToolResult => ({
  ok: false,
  toolCallId,
  error: { code: "tool_failed", message: error instanceof Error ? error.message : String(error), retryable: false },
  audit: { userId: ctx.userId, accountId: ctx.accountId, startedAt, completedAt: new Date().toISOString() },
});

const themeSchema = {
  borderColor: z.string().regex(/^#[0-9a-f]{6}$/i),
  fontColor: z.string().regex(/^#[0-9a-f]{6}$/i),
  buttonColor: z.string().regex(/^#[0-9a-f]{6}$/i),
  backgroundColor: z.string().regex(/^#[0-9a-f]{6}$/i),
};

export const templatesListTool: AgentToolDefinition = {
  name: "templates.list",
  description: "List available built-in and user-created email templates and identify the currently selected default template.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  requiredScopes: ["templates.read"],
  risk: "read",
  async execute(ctx, _rawInput, toolCallId) {
    const startedAt = new Date().toISOString();
    try {
      const [custom, settings] = await Promise.all([
        listCustomEmailTemplates(ctx.userId),
        db.select({ general: userSettings.general }).from(userSettings).where(eq(userSettings.userId, ctx.userId)).limit(1),
      ]);
      return success(ctx, toolCallId, startedAt, {
        selectedTemplateKey: typeof settings[0]?.general?.templateKey === "string" ? settings[0].general.templateKey : "none",
        templates: [
          ...MAIL_TEMPLATE_CATALOG.map((template) => ({ key: template.key, name: template.name, kind: "builtin" })),
          ...custom.map((template) => ({ key: template.key, id: template.id, name: template.name, kind: "custom", theme: {
            borderColor: template.borderColor,
            fontColor: template.fontColor,
            buttonColor: template.buttonColor,
            backgroundColor: template.backgroundColor,
          }, hasLogo: Boolean(template.logoUrl) })),
        ],
      });
    } catch (error) {
      return failure(ctx, toolCallId, startedAt, error);
    }
  },
};

export const templatesGetTool: AgentToolDefinition = {
  name: "templates.get",
  description: "Read one custom email template's name, brand colors, and logo asset reference by template ID or custom key. Does not expose other users' templates.",
  inputSchema: {
    type: "object",
    properties: { templateId: { type: "string", description: "UUID or custom:<uuid> key" } },
    required: ["templateId"],
    additionalProperties: false,
  },
  requiredScopes: ["templates.read"],
  risk: "read",
  async execute(ctx, rawInput, toolCallId) {
    const startedAt = new Date().toISOString();
    try {
      const { templateId } = z.object({ templateId: z.string().regex(/^(?:custom:)?[0-9a-f]{8}-[0-9a-f-]{27,}$/i) }).parse(rawInput);
      const template = await getCustomEmailTemplate(ctx.userId, templateId);
      return success(ctx, toolCallId, startedAt, {
        id: template.id, key: template.key, name: template.name,
        subject: template.subject, preheader: template.preheader, bodyText: template.bodyText,
        borderColor: template.borderColor, fontColor: template.fontColor,
        buttonColor: template.buttonColor, backgroundColor: template.backgroundColor,
        logoAssetId: template.logoAssetId, logoFilename: template.logoFilename,
        updatedAt: template.updatedAt,
      });
    } catch (error) {
      return failure(ctx, toolCallId, startedAt, error);
    }
  },
};

export const templatesDuplicateTool: AgentToolDefinition = {
  name: "templates.duplicate",
  description: "Duplicate a custom GSW Mail template's branding into a new independent template. Copies colors and owned logo asset reference, not arbitrary HTML.",
  inputSchema: {
    type: "object",
    properties: {
      templateId: { type: "string" },
      name: { type: "string" },
      subject: { type: "string", maxLength: 300 },
      preheader: { type: "string", maxLength: 500 },
      bodyText: { type: "string", maxLength: 50000 },
      logoAssetId: { type: "string", description: "Owned existing logo asset UUID; null to clear" },
    },
    required: ["templateId", "name"],
    additionalProperties: false,
  },
  requiredScopes: ["templates.write"],
  risk: "reversible_write",
  async execute(ctx, rawInput, toolCallId) {
    const startedAt = new Date().toISOString();
    try {
      const { templateId, name } = z.object({
        templateId: z.string().uuid(),
        name: z.string().trim().min(1).max(120),
      }).parse(rawInput);
      const source = await getCustomEmailTemplate(ctx.userId, templateId);
      const duplicate = await createCustomEmailTemplate(ctx.userId, {
        name, subject: source.subject, preheader: source.preheader, bodyText: source.bodyText,
        borderColor: source.borderColor, fontColor: source.fontColor,
        buttonColor: source.buttonColor, backgroundColor: source.backgroundColor,
        logoAssetId: source.logoAssetId, logoFilename: source.logoFilename,
      });
      return success(ctx, toolCallId, startedAt, { ...duplicate, sourceTemplateId: source.id });
    } catch (error) {
      return failure(ctx, toolCallId, startedAt, error);
    }
  },
};

export const templatesCreateTool: AgentToolDefinition = {
  name: "templates.create",
  description: "Create a native branded email template with editable subject, preheader, body text, colors and an optional owned logo.",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string" },
      subject: { type: "string", maxLength: 300 },
      preheader: { type: "string", maxLength: 500 },
      bodyText: { type: "string", maxLength: 50000 },
      borderColor: { type: "string" },
      fontColor: { type: "string" },
      buttonColor: { type: "string" },
      backgroundColor: { type: "string" },
      logoAssetId: { type: "string", description: "Optional already-uploaded owned image asset UUID" },
    },
    required: ["name", "borderColor", "fontColor", "buttonColor", "backgroundColor"],
    additionalProperties: false,
  },
  requiredScopes: ["templates.write"],
  risk: "reversible_write",
  async execute(ctx, rawInput, toolCallId) {
    const startedAt = new Date().toISOString();
    try {
      const input = z.object({ name: z.string().trim().min(1).max(120), subject: z.string().max(300).optional(), preheader: z.string().max(500).optional(), bodyText: z.string().max(50000).optional(), ...themeSchema, logoAssetId: z.string().uuid().optional() }).parse(rawInput);
      const { subject, preheader, bodyText, logoAssetId, ...required } = input;
      const template = await createCustomEmailTemplate(ctx.userId, {
        ...required,
        ...(subject !== undefined ? { subject } : {}),
        ...(preheader !== undefined ? { preheader } : {}),
        ...(bodyText !== undefined ? { bodyText } : {}),
        ...(logoAssetId !== undefined ? { logoAssetId } : {}),
      });
      return success(ctx, toolCallId, startedAt, template);
    } catch (error) {
      return failure(ctx, toolCallId, startedAt, error);
    }
  },
};

export const templatesUpdateTool: AgentToolDefinition = {
  name: "templates.update",
  description: "Edit a native email template subject, preheader, body text, brand colors or owned logo.",
  inputSchema: {
    type: "object",
    properties: {
      templateId: { type: "string" },
      name: { type: "string" },
      borderColor: { type: "string" },
      fontColor: { type: "string" },
      buttonColor: { type: "string" },
      backgroundColor: { type: "string" },
    },
    required: ["templateId"],
    additionalProperties: false,
  },
  requiredScopes: ["templates.write"],
  risk: "reversible_write",
  async execute(ctx, rawInput, toolCallId) {
    const startedAt = new Date().toISOString();
    try {
      const input = z.object({
        templateId: z.string().uuid(),
        name: z.string().trim().min(1).max(120).optional(),
        subject: z.string().max(300).nullable().optional(),
        preheader: z.string().max(500).nullable().optional(),
        bodyText: z.string().max(50000).nullable().optional(),
        logoAssetId: z.string().uuid().nullable().optional(),
        borderColor: themeSchema.borderColor.optional(),
        fontColor: themeSchema.fontColor.optional(),
        buttonColor: themeSchema.buttonColor.optional(),
        backgroundColor: themeSchema.backgroundColor.optional(),
      }).parse(rawInput);
      const { templateId, ...patch } = input;
      const cleanPatch = {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.subject !== undefined ? { subject: patch.subject } : {}),
        ...(patch.preheader !== undefined ? { preheader: patch.preheader } : {}),
        ...(patch.bodyText !== undefined ? { bodyText: patch.bodyText } : {}),
        ...(patch.logoAssetId !== undefined ? { logoAssetId: patch.logoAssetId } : {}),
        ...(patch.borderColor !== undefined ? { borderColor: patch.borderColor } : {}),
        ...(patch.fontColor !== undefined ? { fontColor: patch.fontColor } : {}),
        ...(patch.buttonColor !== undefined ? { buttonColor: patch.buttonColor } : {}),
        ...(patch.backgroundColor !== undefined ? { backgroundColor: patch.backgroundColor } : {}),
      };
      const template = await updateCustomEmailTemplate(ctx.userId, templateId, cleanPatch);
      return success(ctx, toolCallId, startedAt, template);
    } catch (error) {
      return failure(ctx, toolCallId, startedAt, error);
    }
  },
};

export const templatesSelectTool: AgentToolDefinition = {
  name: "templates.select",
  description: "Set one available email template as the user's default for compose, AI drafts, and campaign sends.",
  inputSchema: {
    type: "object",
    properties: { templateKey: { type: "string" } },
    required: ["templateKey"],
    additionalProperties: false,
  },
  requiredScopes: ["templates.write"],
  risk: "reversible_write",
  async execute(ctx, rawInput, toolCallId) {
    const startedAt = new Date().toISOString();
    try {
      const { templateKey } = z.object({ templateKey: z.string().trim().min(1).max(200) }).parse(rawInput);
      const custom = (await listCustomEmailTemplates(ctx.userId)).some((template) => template.key === templateKey);
      const builtIn = MAIL_TEMPLATE_CATALOG.some((template) => template.key === templateKey);
      if (!custom && !builtIn) throw new Error("email template not found");
      const [current] = await db.select().from(userSettings).where(eq(userSettings.userId, ctx.userId)).limit(1);
      const general = { ...(current?.general ?? {}), templateKey };
      await db.insert(userSettings).values({
        userId: ctx.userId,
        general,
        compose: current?.compose ?? {},
        contacts: current?.contacts ?? {},
        ai: current?.ai ?? {},
      }).onConflictDoUpdate({ target: userSettings.userId, set: { general } });
      return success(ctx, toolCallId, startedAt, { templateKey });
    } catch (error) {
      return failure(ctx, toolCallId, startedAt, error);
    }
  },
};

export const templateTools: AgentToolDefinition[] = [
  templatesListTool,
  templatesGetTool,
  templatesCreateTool,
  templatesDuplicateTool,
  templatesUpdateTool,
  templatesSelectTool,
];
