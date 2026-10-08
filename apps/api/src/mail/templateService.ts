import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { assets, emailTemplates } from "../db/schema.js";
import { badRequest, notFound } from "../lib/errors.js";
import { renderMailTemplate, resolveMailTemplateKey } from "./templates/index.js";
import type { MailTemplateInput, RenderedMailTemplate } from "./templates/types.js";

export interface EmailTemplateTheme {
  borderColor: string;
  fontColor: string;
  buttonColor: string;
  backgroundColor: string;
}

export interface CustomEmailTemplateRecord extends EmailTemplateTheme {
  id: string;
  key: string;
  name: string;
  logoUrl: string | null;
  logoFilename: string | null;
  logoAssetId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CustomEmailTemplateInput extends EmailTemplateTheme {
  name: string;
  logoDataUrl?: string | null | undefined;
  logoFilename?: string | null | undefined;
  logoAssetId?: string | null | undefined;
}

export interface CustomEmailTemplatePatch {
  name?: string | undefined;
  borderColor?: string | undefined;
  fontColor?: string | undefined;
  buttonColor?: string | undefined;
  backgroundColor?: string | undefined;
  logoDataUrl?: string | null | undefined;
  logoFilename?: string | null | undefined;
  logoAssetId?: string | null | undefined;
}

const colorPattern = /^#[0-9a-f]{6}$/i;
const normalizeColor = (value: string, field: string) => {
  const color = value.trim();
  if (!colorPattern.test(color)) throw badRequest(`${field} must be a 6-digit hex color`);
  return color.toLowerCase();
};

const assetUrl = (id: string) => `https://mail.guidedstepswellness.com/product/template-assets/${id}/logo`;

const present = (row: typeof emailTemplates.$inferSelect): CustomEmailTemplateRecord => ({
  id: row.id,
  key: row.key,
  name: row.name,
  borderColor: row.borderColor,
  fontColor: row.fontColor,
  buttonColor: row.buttonColor,
  backgroundColor: row.backgroundColor,
  logoUrl: row.logoAssetId || row.logoBase64 ? assetUrl(row.id) : null,
  logoFilename: row.logoFilename,
  logoAssetId: row.logoAssetId,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

async function validateLogoAsset(userId: string, assetId?: string | null) {
  if (!assetId) return null;
  const [asset] = await db.select({
    id: assets.id,
    mimeType: assets.mimeType,
    status: assets.status,
  }).from(assets).where(and(
    eq(assets.id, assetId),
    eq(assets.userId, userId),
  )).limit(1);
  if (!asset || asset.status !== "ready") throw badRequest("template logo asset is not ready");
  if (!asset.mimeType.startsWith("image/")) throw badRequest("template logo must be an image");
  return asset.id;
}

function parseLogo(dataUrl?: string | null) {
  if (!dataUrl) return { logoMimeType: null, logoBase64: null };
  const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match) throw badRequest("logo must be a PNG, JPEG, WEBP, or GIF image");
  const bytes = Buffer.from(match[2]!, "base64");
  if (bytes.length > 1024 * 1024) throw badRequest("logo must be 1 MB or smaller");
  return { logoMimeType: match[1]!, logoBase64: match[2]! };
}

export async function listCustomEmailTemplates(userId: string) {
  const rows = await db.select().from(emailTemplates)
    .where(eq(emailTemplates.userId, userId))
    .orderBy(asc(emailTemplates.name));
  return rows.map(present);
}

export async function getCustomEmailTemplate(userId: string, keyOrId: string) {
  const [row] = await db.select().from(emailTemplates).where(and(
    eq(emailTemplates.userId, userId),
    keyOrId.startsWith("custom:") ? eq(emailTemplates.key, keyOrId) : eq(emailTemplates.id, keyOrId),
  )).limit(1);
  if (!row) throw notFound("email template not found");
  return row;
}

export async function createCustomEmailTemplate(userId: string, input: CustomEmailTemplateInput) {
  const name = input.name.trim();
  if (!name) throw badRequest("template name is required");
  if (name.length > 120) throw badRequest("template name is too long");
  const id = randomUUID();
  const logo = parseLogo(input.logoDataUrl);
  const logoAssetId = await validateLogoAsset(userId, input.logoAssetId);
  const [row] = await db.insert(emailTemplates).values({
    id,
    userId,
    key: `custom:${id}`,
    name,
    borderColor: normalizeColor(input.borderColor, "border color"),
    fontColor: normalizeColor(input.fontColor, "font color"),
    buttonColor: normalizeColor(input.buttonColor, "button color"),
    backgroundColor: normalizeColor(input.backgroundColor, "background color"),
    ...logo,
    logoFilename: input.logoFilename?.trim().slice(0, 255) || null,
    logoAssetId,
  }).returning();
  if (!row) throw new Error("failed to create email template");
  return present(row);
}

export async function updateCustomEmailTemplate(userId: string, id: string, input: CustomEmailTemplatePatch) {
  const existing = await getCustomEmailTemplate(userId, id);
  const logo = input.logoDataUrl === undefined ? {} : parseLogo(input.logoDataUrl);
  const logoAsset = input.logoAssetId === undefined ? {} : { logoAssetId: await validateLogoAsset(userId, input.logoAssetId) };
  const [row] = await db.update(emailTemplates).set({
    ...(input.name !== undefined ? { name: input.name.trim().slice(0, 120) } : {}),
    ...(input.borderColor !== undefined ? { borderColor: normalizeColor(input.borderColor, "border color") } : {}),
    ...(input.fontColor !== undefined ? { fontColor: normalizeColor(input.fontColor, "font color") } : {}),
    ...(input.buttonColor !== undefined ? { buttonColor: normalizeColor(input.buttonColor, "button color") } : {}),
    ...(input.backgroundColor !== undefined ? { backgroundColor: normalizeColor(input.backgroundColor, "background color") } : {}),
    ...logo,
    ...logoAsset,
    ...(input.logoFilename !== undefined ? { logoFilename: input.logoFilename?.trim().slice(0, 255) || null } : {}),
    updatedAt: new Date(),
  }).where(and(eq(emailTemplates.id, existing.id), eq(emailTemplates.userId, userId))).returning();
  if (!row) throw notFound("email template not found");
  return present(row);
}

export async function deleteCustomEmailTemplate(userId: string, id: string) {
  const [row] = await db.delete(emailTemplates).where(and(
    eq(emailTemplates.id, id),
    eq(emailTemplates.userId, userId),
  )).returning({ id: emailTemplates.id, key: emailTemplates.key });
  if (!row) throw notFound("email template not found");
  return row;
}

const escapeHtml = (value: string) => value
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#39;");

const textToHtml = (value: string) => escapeHtml(value).replaceAll("\n", "<br />");

function styleBodyLinks(html: string, buttonColor: string) {
  return html.replace(/<a\b([^>]*)>/gi, (match, attrs: string) => {
    if (/style\s*=/.test(attrs)) return match;
    return `<a${attrs} style="color:${buttonColor};font-weight:600;text-decoration:none">`;
  });
}

export function renderCustomEmailTemplate(
  template: Pick<typeof emailTemplates.$inferSelect, "id" | "name" | "borderColor" | "fontColor" | "buttonColor" | "backgroundColor" | "logoBase64" | "logoAssetId">,
  input: MailTemplateInput,
): RenderedMailTemplate {
  const text = input.bodyText ?? "";
  const body = styleBodyLinks(input.bodyHtml ?? textToHtml(text), template.buttonColor);
  const logo = template.logoAssetId || template.logoBase64
    ? `<img src="${assetUrl(template.id)}" alt="${escapeHtml(template.name)}" width="52" height="52" style="display:block;width:52px;height:52px;object-fit:contain;margin-bottom:12px;border:0" />`
    : "";
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"></head><body style="margin:0"><div style="margin:0;background:${template.backgroundColor};color:${template.fontColor};font-family:Arial,sans-serif;line-height:1.6;width:100%;padding:32px 16px;box-sizing:border-box"><div style="max-width:620px;margin:0 auto;background:#fff;border:1px solid ${template.borderColor};border-radius:12px;overflow:hidden"><div style="padding:18px 24px;border-bottom:2px solid ${template.borderColor}">${logo}<div style="color:${template.fontColor};font-size:16px;font-weight:700">${escapeHtml(template.name)}</div></div><div style="padding:28px 24px;font-size:15px;color:${template.fontColor}">${body}</div></div></div></body></html>`;
  return { text, html };
}

export async function renderTemplateForUser(userId: string, key: string | null | undefined, input: MailTemplateInput) {
  if (key?.startsWith("custom:")) {
    const template = await getCustomEmailTemplate(userId, key);
    return { rendered: renderCustomEmailTemplate(template, input), templateKey: template.key };
  }
  const builtInKey = resolveMailTemplateKey(key);
  return { rendered: renderMailTemplate(builtInKey, input), templateKey: builtInKey };
}

export const isCustomTemplateKey = (key?: string | null): key is string => Boolean(key?.startsWith("custom:"));
