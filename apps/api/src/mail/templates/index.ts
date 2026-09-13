import { config } from "../../config.js";
import type { MailTemplate, MailTemplateInput, RenderedMailTemplate } from "./types.js";

const escapeHtml = (value: string): string => value
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#39;");

const textToHtml = (value: string): string => escapeHtml(value).replaceAll("\n", "<br />");

export const gswDefaultTemplate: MailTemplate = {
  key: "gsw_default",
  name: "Guided Steps Wellness: The Community",
  category: "personal",
  description: "A restrained branded wrapper for everyday mail.",
  render: (input: MailTemplateInput): RenderedMailTemplate => {
    const text = input.bodyText ?? "";
    const body = input.bodyHtml ?? textToHtml(text);
    return {
      text,
      html: `<!doctype html><html lang="en"><body style="margin:0;background:#f7f3ea;color:#484640;font-family:Arial,sans-serif;line-height:1.6"><div style="width:100%;padding:32px 16px"><div style="max-width:620px;margin:0 auto;background:#fff;border:1px solid #e8e1d4;border-radius:12px;overflow:hidden"><div style="padding:18px 24px;border-bottom:2px solid #e89a12;color:#292824;font-size:16px;font-weight:700">Guided Steps Wellness: The Community</div><div style="padding:28px 24px;font-size:15px">${body}</div><div style="padding:16px 24px;border-top:1px solid #eee9df;color:#77756f;font-size:12px">Guided Steps Wellness: The Community<br />Building community with purpose.</div></div></div></body></html>`,
    };
  },
};

export const bibleReaderTemplate: MailTemplate = {
  key: "bible_reader",
  name: "Bible Study Reader",
  category: "ministry",
  defaultSubject: "{{subject}}",
  description: "A calm, devotional template for Bible Study Reader messages.",
  availableVariables: [
    "recipient_name",
    "email_body",
    "cta_label",
    "cta_url",
    "lesson_title",
    "scripture_reference",
    "scripture_text",
    "community_name",
    "sender_name",
    "sender_title",
  ],
  render: (input: MailTemplateInput): RenderedMailTemplate => {
    const recipient = input.recipientName ? `Hello ${input.recipientName},` : "Hello,";
    const textBody = [
      recipient,
      input.lessonTitle,
      input.bodyText ?? "",
      input.scriptureText ? `\"${input.scriptureText}\"${input.scriptureReference ? `\n${input.scriptureReference}` : ""}` : "",
      input.ctaLabel && input.ctaUrl ? `${input.ctaLabel}: ${input.ctaUrl}` : "",
      input.senderName ? `\n${input.senderName}${input.senderTitle ? `\n${input.senderTitle}` : ""}` : "",
    ].filter(Boolean).join("\n\n");
    const body = input.bodyHtml ?? textToHtml(input.bodyText ?? "");
    const lesson = input.lessonTitle ? `<div style="margin:0 0 18px;color:#292824;font-size:20px;font-weight:700">${escapeHtml(input.lessonTitle)}</div>` : "";
    const scripture = input.scriptureText
      ? `<div style="margin:24px 0;padding:18px 20px;border-left:3px solid #b98a45;background:#fbf8f1;color:#5d5142"><div style="font-family:Georgia,serif;font-size:17px;font-style:italic">&ldquo;${escapeHtml(input.scriptureText)}&rdquo;</div>${input.scriptureReference ? `<div style="margin-top:8px;font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase">${escapeHtml(input.scriptureReference)}</div>` : ""}</div>`
      : "";
    const cta = input.ctaLabel && input.ctaUrl
      ? `<div style="margin:26px 0 6px"><a href="${escapeHtml(input.ctaUrl)}" style="display:inline-block;padding:12px 20px;border-radius:6px;background:#b98a45;color:#fff;font-size:14px;font-weight:700;text-decoration:none">${escapeHtml(input.ctaLabel)}</a></div>`
      : "";
    const sender = input.senderName ? `<div style="margin-top:24px;color:#77756f;font-size:13px">${escapeHtml(input.senderName)}${input.senderTitle ? `<br />${escapeHtml(input.senderTitle)}` : ""}</div>` : "";
    return {
      text: textBody,
      html: `<!doctype html><html lang="en"><body style="margin:0;background:#f8f6f0;color:#484640;font-family:Arial,sans-serif;line-height:1.6"><div style="width:100%;padding:32px 16px"><div style="max-width:620px;margin:0 auto;background:#fff;border:1px solid #e8e1d4;border-radius:10px;overflow:hidden"><div style="padding:22px 24px;border-bottom:1px solid #e8e1d4"><div style="display:inline-grid;width:34px;height:34px;place-items:center;border:1px solid #d8c4a4;border-radius:50%;color:#8d6b37;font-family:Georgia,serif;font-size:12px;font-weight:700">BSR</div><div style="margin-top:12px;color:#292824;font-family:Georgia,serif;font-size:20px;font-weight:700">Bible Study Reader</div><div style="margin-top:3px;color:#77756f;font-size:13px">Study the Word. Grow together.</div></div><div style="padding:30px 24px;font-size:15px">${lesson}<div style="margin-bottom:18px">${escapeHtml(recipient)}</div>${body}${scripture}${cta}${sender}</div><div style="padding:18px 24px;border-top:1px solid #eee9df;color:#77756f;font-size:12px">A study Bible you can use anywhere, anytime.<br /><span style="color:#5d5142">Read &bull; Highlight &bull; Notes &bull; Share</span><br /><br />Guided Steps Wellness<br /><a href="https://bible.guidedstepswellness.com" style="color:#8d6b37;text-decoration:none">bible.guidedstepswellness.com</a></div></div></div></body></html>`,
    };
  },
};

export const MAIL_TEMPLATES: Record<string, MailTemplate> = {
  gsw_default: gswDefaultTemplate,
  bible_reader: bibleReaderTemplate,
};

export const DEFAULT_MAIL_TEMPLATE_KEY = config.mail.defaultTemplateKey;

export const renderMailTemplate = (key: string, input: MailTemplateInput): RenderedMailTemplate => {
  const template = MAIL_TEMPLATES[key];
  if (!template) throw new Error(`unknown mail template: ${key}`);
  return template.render(input);
};
