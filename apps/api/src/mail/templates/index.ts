import { config } from "../../config.js";

import type { MailTemplate, MailTemplateInput, RenderedMailTemplate } from "./types.js";

export type MailTemplateKey = "none" | "gsw_default" | "bible_reader";
export const MAIL_TEMPLATE_VERSION = "2026-09-23-v3";

const escapeHtml = (value: string): string => value
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#39;");

const textToHtml = (value: string): string => escapeHtml(value).replaceAll("\n", "<br />");
const mailAssetUrl = (filename: string): string => `https://mail.guidedstepswellness.com/${filename}?v=${encodeURIComponent(MAIL_TEMPLATE_VERSION)}`;

const socialLink = (url: string, icon: string, label: string): string =>
  `<td style="padding:0 18px 0 0;vertical-align:middle;white-space:nowrap"><a href="${url}" target="_blank" rel="noopener noreferrer" style="color:#6f6b63;text-decoration:none;font-size:12px"><img src="${mailAssetUrl(icon)}" alt="" width="18" height="18" style="display:inline-block;width:18px;height:18px;border:0;vertical-align:middle;margin-right:6px" />${label}</a></td>`;

const socialRow = (links: string): string =>
  `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:12px;border-collapse:collapse"><tr>${links}</tr></table>`;

const gswSocialLinks = socialRow(
  `${socialLink("https://www.facebook.com/profile.php?id=61584353387952", "facebook-email-icon.png", "Facebook")}${socialLink("https://www.linkedin.com/company/guided-steps-wellness-the-community/posts/?viewAsMember=true", "linkedin-email-icon.png", "LinkedIn")}`,
);
const bibleSocialLinks = socialRow(
  socialLink("https://www.youtube.com/@bible_study_app", "youtube-email-icon.png", "YouTube"),
);

const documentShell = (key: Exclude<MailTemplateKey, "none">, content: string): string =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="x-gsw-template" content="${key}:${MAIL_TEMPLATE_VERSION}"></head><body style="margin:0">${content}<!-- gsw-template:${key}:${MAIL_TEMPLATE_VERSION} --></body></html>`;

export const noTemplate: MailTemplate = {
  key: "none",
  name: "No Template",
  category: "plain",
  description: "Send the message exactly as composed, without branded template framing or footer content.",
  render: (input: MailTemplateInput): RenderedMailTemplate => {
    const text = input.bodyText ?? "";
    return {
      text,
      html: input.bodyHtml ?? textToHtml(text),
    };
  },
};

export const gswDefaultTemplate: MailTemplate = {
  key: "gsw_default",
  name: "Guided Steps Wellness: The Community",
  category: "personal",
  description: "Guided Steps Wellness community branding with project links.",
  render: (input: MailTemplateInput): RenderedMailTemplate => {
    const text = input.bodyText ?? "";
    const body = input.bodyHtml ?? textToHtml(text);
    return {
      text,
      html: documentShell("gsw_default", `<div style="margin:0;background:#f7f3ea;color:#484640;font-family:Arial,sans-serif;line-height:1.6;width:100%;padding:32px 16px;box-sizing:border-box"><div style="max-width:620px;margin:0 auto;background:#fff;border:1px solid #e8e1d4;border-radius:12px;overflow:hidden"><div style="padding:18px 24px;border-bottom:2px solid #e89a12"><img src="${mailAssetUrl("guided_steps_logo.png")}" alt="Guided Steps Wellness" width="52" height="52" style="display:block;width:52px;height:52px;object-fit:contain;margin-bottom:12px;border:0" /><div style="color:#292824;font-size:16px;font-weight:700">Guided Steps Wellness: The Community</div></div><div style="padding:28px 24px;font-size:15px">${body}</div><div style="padding:16px 24px;border-top:1px solid #eee9df;color:#77756f;font-size:12px">Guided Steps Wellness: The Community<br /><a href="https://thecommunity.guidedstepswellness.com/" style="color:#8d6b37;text-decoration:none">thecommunity.guidedstepswellness.com</a><br />Building community with purpose.${gswSocialLinks}</div></div></div>`),
    };
  },
};

export const bibleReaderTemplate: MailTemplate = {
  key: "bible_reader",
  name: "Bible Study Reader",
  category: "ministry",
  defaultSubject: "{{subject}}",
  description: "Bible Study Reader ministry branding with Bible project links.",
  availableVariables: [
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
    const textBody = [
      input.lessonTitle,
      input.bodyText ?? "",
      input.scriptureText ? `"${input.scriptureText}"${input.scriptureReference ? `\n${input.scriptureReference}` : ""}` : "",
      input.ctaLabel && input.ctaUrl ? `${input.ctaLabel}: ${input.ctaUrl}` : "",
    ].filter(Boolean).join("\n\n");
    const body = input.bodyHtml ?? textToHtml(input.bodyText ?? "");
    const lesson = input.lessonTitle ? `<div style="margin:0 0 18px;color:#292824;font-size:20px;font-weight:700">${escapeHtml(input.lessonTitle)}</div>` : "";
    const scripture = input.scriptureText
      ? `<div style="margin:24px 0;padding:18px 20px;border-left:3px solid #b98a45;background:#fbf8f1;color:#5d5142"><div style="font-family:Georgia,serif;font-size:17px;font-style:italic">&ldquo;${escapeHtml(input.scriptureText)}&rdquo;</div>${input.scriptureReference ? `<div style="margin-top:8px;font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase">${escapeHtml(input.scriptureReference)}</div>` : ""}</div>`
      : "";
    const cta = input.ctaLabel && input.ctaUrl
      ? `<div style="margin:26px 0 6px"><a href="${escapeHtml(input.ctaUrl)}" style="display:inline-block;padding:12px 20px;border-radius:6px;background:#b98a45;color:#fff;font-size:14px;font-weight:700;text-decoration:none">${escapeHtml(input.ctaLabel)}</a></div>`
      : "";
    return {
      text: textBody,
      html: documentShell("bible_reader", `<div style="margin:0;background:#f8f6f0;color:#484640;font-family:Arial,sans-serif;line-height:1.6;width:100%;padding:32px 16px;box-sizing:border-box"><div style="max-width:620px;margin:0 auto;background:#fff;border:1px solid #e8e1d4;border-radius:10px;overflow:hidden"><div style="padding:22px 24px;border-bottom:1px solid #e8e1d4"><img src="${mailAssetUrl("bible_app.png")}" alt="Bible Study Reader" width="48" height="48" style="display:block;width:48px;height:48px;object-fit:contain;margin-bottom:12px;border:0" /><div style="color:#292824;font-family:Georgia,serif;font-size:20px;font-weight:700">Bible Study Reader</div><div style="margin-top:3px;color:#77756f;font-size:13px">Study the Word. Grow together.</div></div><div style="padding:30px 24px;font-size:15px">${lesson}${body}${scripture}${cta}</div><div style="padding:18px 24px;border-top:1px solid #eee9df;color:#77756f;font-size:12px">A study Bible you can use anywhere, anytime.<br /><span style="color:#5d5142">Read &bull; Highlight &bull; Notes &bull; Share</span><br /><br />Guided Steps Wellness<br /><a href="https://bible.guidedstepswellness.com" style="color:#8d6b37;text-decoration:none">bible.guidedstepswellness.com</a>${bibleSocialLinks}</div></div></div>`),
    };
  },
};

export const MAIL_TEMPLATES: Record<MailTemplateKey, MailTemplate> = {
  none: noTemplate,
  gsw_default: gswDefaultTemplate,
  bible_reader: bibleReaderTemplate,
};

export const MAIL_TEMPLATE_CATALOG = Object.values(MAIL_TEMPLATES).map((template) => ({
  key: template.key as MailTemplateKey,
  name: template.name,
  category: template.category,
  description: template.description,
  version: MAIL_TEMPLATE_VERSION,
}));

export const DEFAULT_MAIL_TEMPLATE_KEY: MailTemplateKey =
  config.mail.defaultTemplateKey === "bible_reader"
    ? "bible_reader"
    : config.mail.defaultTemplateKey === "gsw_default"
      ? "gsw_default"
      : "none";

export const resolveMailTemplateKey = (key?: string | null): MailTemplateKey =>
  key === "bible_reader" ? "bible_reader" : key === "gsw_default" ? "gsw_default" : "none";

export const renderMailTemplate = (key: MailTemplateKey, input: MailTemplateInput): RenderedMailTemplate =>
  MAIL_TEMPLATES[key].render(input);
