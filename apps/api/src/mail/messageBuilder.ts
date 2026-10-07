import { richTextToPlainText, sanitizeRichText } from "../lib/richText.js";
import { renderMailTemplate, type MailTemplateKey } from "./templates/index.js";
import { renderTemplateForUser } from "./templateService.js";

export interface BuildOutgoingMessageInput {
  bodyHtml?: string | undefined;
  bodyText?: string | undefined;
  templateKey: MailTemplateKey;
  senderName?: string | undefined;
  senderEmail: string;
}

export interface BuildOutgoingMessageForUserInput {
  userId: string;
  bodyHtml?: string | undefined;
  bodyText?: string | undefined;
  templateKey: string;
  senderName?: string | undefined;
  senderEmail: string;
}

export interface BuiltOutgoingMessage {
  bodyHtml: string;
  bodyText: string;
  html: string;
  text: string;
  templateKey: string;
}

/**
 * Outbound templates are presentation-only wrappers.
 *
 * The compose/draft body is the single source of truth for user-authored content,
 * including the user's signature. Signature enablement and placement happen in the
 * compose experience before the draft is saved. The API must not fetch or append a
 * second signature while rendering a branded template.
 */
const composeBody = (input: { bodyHtml?: string | undefined; bodyText?: string | undefined }): { html: string; text: string } => {
  const html = sanitizeRichText(input.bodyHtml ?? "").trim();
  const text = html ? richTextToPlainText(html) : (input.bodyText ?? "");
  return { html, text };
};

/** Synchronous built-in renderer retained for deterministic tests and legacy call sites. */
export function buildOutgoingMessage(input: BuildOutgoingMessageInput): BuiltOutgoingMessage {
  const body = composeBody(input);
  const rendered = renderMailTemplate(input.templateKey, {
    bodyHtml: body.html,
    bodyText: body.text,
    senderName: input.senderName,
    senderEmail: input.senderEmail,
  });
  return {
    bodyHtml: body.html,
    bodyText: body.text,
    html: rendered.html,
    text: rendered.text,
    templateKey: input.templateKey,
  };
}

/** User-aware renderer that can load custom templates from the database. */
export async function buildOutgoingMessageForUser(input: BuildOutgoingMessageForUserInput): Promise<BuiltOutgoingMessage> {
  const body = composeBody(input);
  const result = await renderTemplateForUser(input.userId, input.templateKey, {
    bodyHtml: body.html,
    bodyText: body.text,
    senderName: input.senderName,
    senderEmail: input.senderEmail,
  });
  return {
    bodyHtml: body.html,
    bodyText: body.text,
    html: result.rendered.html,
    text: result.rendered.text,
    templateKey: result.templateKey,
  };
}
