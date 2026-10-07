import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client.js";
import { userSettings } from "../../db/schema.js";
import {
  createCustomEmailTemplate,
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

export const templatesCreateTool: AgentToolDefinition = {
  name: "templates.create",
  description: "Create a custom GSW Mail email template with a name and simple brand colors. Logo upload remains a user-driven Settings action.",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string" },
      borderColor: { type: "string" },
      fontColor: { type: "string" },
      buttonColor: { type: "string" },
      backgroundColor: { type: "string" },
    },
    required: ["name", "borderColor", "fontColor", "buttonColor", "backgroundColor"],
    additionalProperties: false,
  },
  requiredScopes: ["templates.write"],
  risk: "reversible_write",
  async execute(ctx, rawInput, toolCallId) {
    const startedAt = new Date().toISOString();
    try {
      const input = z.object({ name: z.string().trim().min(1).max(120), ...themeSchema }).parse(rawInput);
      const template = await createCustomEmailTemplate(ctx.userId, input);
      return success(ctx, toolCallId, startedAt, template);
    } catch (error) {
      return failure(ctx, toolCallId, startedAt, error);
    }
  },
};

export const templatesUpdateTool: AgentToolDefinition = {
  name: "templates.update",
  description: "Rename or change the simple brand colors of an existing user-created email template.",
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
        borderColor: themeSchema.borderColor.optional(),
        fontColor: themeSchema.fontColor.optional(),
        buttonColor: themeSchema.buttonColor.optional(),
        backgroundColor: themeSchema.backgroundColor.optional(),
      }).parse(rawInput);
      const { templateId, ...patch } = input;
      const template = await updateCustomEmailTemplate(ctx.userId, templateId, patch);
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
  templatesCreateTool,
  templatesUpdateTool,
  templatesSelectTool,
];
