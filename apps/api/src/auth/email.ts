const escapeHtml = (value: string): string => value
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#39;");

export function renderGswAuthEmail(input: {
  title: string;
  message: string;
  code?: string;
  ctaUrl?: string;
  ctaLabel?: string;
  expiryMinutes?: number;
}): { html: string; text: string } {
  const expiry = input.expiryMinutes ? `This code expires in ${input.expiryMinutes} minutes.` : "";
  const code = input.code ? `<div style="display:inline-block;padding:16px 28px;background:#fff3d7;border-radius:14px;font-size:30px;letter-spacing:8px;font-weight:700;color:#2f2f2f">${escapeHtml(input.code)}</div>` : "";
  const cta = input.ctaUrl && input.ctaLabel ? `<a href="${escapeHtml(input.ctaUrl)}" style="display:inline-block;padding:13px 22px;border-radius:999px;background:#e99a18;color:#fff;font-size:15px;font-weight:700;text-decoration:none">${escapeHtml(input.ctaLabel)}</a>` : "";
  const text = [input.title, input.message, input.code ? `Code: ${input.code}` : "", expiry, input.ctaUrl ? `${input.ctaLabel ?? "Continue"}: ${input.ctaUrl}` : "", "If you did not request this, you can safely ignore this email.", "Guided Steps Wellness"].filter(Boolean).join("\n\n");
  return {
    text,
    html: `<!doctype html><html lang="en"><body style="margin:0;background:#fbf8f1;font-family:Arial,sans-serif;color:#2f2f2f"><table width="100%" cellpadding="0" cellspacing="0" style="background:#fbf8f1;padding:40px 16px"><tr><td align="center"><table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border:1px solid #ebe7dd;border-radius:22px;padding:40px"><tr><td align="center"><img src="https://mail.guidedstepswellness.com/guided_steps_logo.png" width="72" alt="Guided Steps Wellness" style="display:block;margin-bottom:18px" /></td></tr><tr><td align="center" style="font-size:13px;letter-spacing:2px;font-weight:700;color:#c87900">GSW ACCOUNT</td></tr><tr><td align="center" style="padding-top:18px;font-family:Georgia,serif;font-size:32px;font-weight:700">${escapeHtml(input.title)}</td></tr><tr><td align="center" style="padding-top:12px;font-size:16px;line-height:24px;color:#8b8b87">${escapeHtml(input.message)}</td></tr>${input.code ? `<tr><td align="center" style="padding:28px 0">${code}</td></tr>` : ""}${cta ? `<tr><td align="center" style="padding:24px 0">${cta}</td></tr>` : ""}<tr><td align="center" style="font-size:14px;color:#8b8b87">${escapeHtml(expiry)}</td></tr><tr><td align="center" style="padding-top:28px;font-size:13px;color:#8b8b87">If you didn't request this, you can safely ignore this email.<br /><br />Guided Steps Wellness</td></tr></table></td></tr></table></body></html>`,
  };
}
