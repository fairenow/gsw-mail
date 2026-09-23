import { richTextToPlainText, sanitizeRichText } from "../lib/richText.js";
import { renderMailTemplate, type MailTemplateKey } from "./templates/index.js";

export type MessageMode = "new" | "reply" | "replyAll" | "forward";

export interface SignaturePolicy {
  enabled: boolean;
  onNew: boolean;
  onReply: boolean;
  onForward: boolean;
  position: "beforeQuotedText" | "afterQuotedText";
  signatureHtml: string;
  signatureText?: string | null | undefined;
}

export interface BuildOutgoingMessageInput {
  bodyHtml?: string | undefined;
  bodyText?: string | undefined;
  mode?: MessageMode | undefined;
  templateKey: MailTemplateKey;
  senderName?: string | undefined;
  senderEmail: string;
  signature?: SignaturePolicy | null | undefined;
}

export interface BuiltOutgoingMessage {
  bodyHtml: string;
  bodyText: string;
  html: string;
  text: string;
  templateKey: MailTemplateKey;
}

const leadingEmptyBlocksPattern = /^(?:\s*(?:<div|<p)[^>]*>\s*(?:&nbsp;|<br\s*\/?>)?\s*<\/(?:div|p)>){1,4}/i;
const trailingEmptyBlocksPattern = /(?:\s*(?:<div|<p)[^>]*>\s*(?:&nbsp;|<br\s*\/?>)?\s*<\/(?:div|p)>){1,4}\s*$/i;
const leadingHelloPattern = /^\s*(?:<div[^>]*>\s*Hello\s*,?\s*<\/div>|<p[^>]*>\s*Hello\s*,?\s*<\/p>|Hello\s*,?)/i;
const leadingSignatureMarkerPattern = /^\s*<div[^>]*(?:class=["'][^"']*\bgsw-signature\b[^"']*["']|data-gsw-signature=["']true["'])[^>]*>/i;
const markedSignaturePattern = /<div[^>]*(?:class=["'][^"']*\bgsw-signature\b[^"']*["']|data-gsw-signature=["']true["'])[^>]*>[\s\S]*?<\/div>(?:\s*<div[^>]*>\s*<br\s*\/?>\s*<\/div>)?/gi;

const signatureEnabledForMode = (signature: SignaturePolicy | null | undefined, mode: MessageMode): boolean => {
  if (!signature?.enabled) return false;
  if (mode === "new") return signature.onNew;
  if (mode === "forward") return signature.onForward;
  return signature.onReply;
};

const stripLegacySignatureArtifacts = (html: string, safeSignature: string): string => {
  let body = html;

  // Older compose builds could persist: Hello -> signature -> actual message -> signature.
  // Detect that shape without compiling the user's signature HTML into a RegExp.
  if (safeSignature) {
    const helloMatch = body.match(leadingHelloPattern);
    if (helloMatch) {
      const afterHello = body.slice(helloMatch[0].length).replace(leadingEmptyBlocksPattern, "").trimStart();
      if (afterHello.startsWith(safeSignature) || leadingSignatureMarkerPattern.test(afterHello)) {
        body = afterHello;
      }
    }
  }

  // The server owns signature placement. Strip any compose/draft copy first, then add
  // exactly one canonical signature later. Exact string replacement avoids regex syntax
  // failures from arbitrary HTML attributes, URLs, parentheses, or pasted formatting.
  body = body.replace(markedSignaturePattern, "");
  if (safeSignature) body = body.split(safeSignature).join("");

  return body
    .trim()
    .replace(leadingEmptyBlocksPattern, "")
    .replace(trailingEmptyBlocksPattern, "")
    .trim();
};

const signatureBlock = (safeSignature: string): string =>
  `<div class="gsw-signature" data-gsw-signature="true">${safeSignature}</div>`;

const insertBeforeQuotedHistory = (body: string, signature: string): string => {
  const quoteCandidates = [
    body.search(/<div[^>]*>\s*On[\s\S]{0,240}?wrote:\s*<\/div>/i),
    body.search(/<blockquote\b/i),
    body.search(/---------- Forwarded message ----------/i),
  ].filter((index) => index >= 0);
  const quoteIndex = quoteCandidates.length ? Math.min(...quoteCandidates) : -1;
  if (quoteIndex < 0) return `${body}${body ? "<div><br></div>" : ""}${signature}`;
  const before = body.slice(0, quoteIndex).trim();
  const after = body.slice(quoteIndex).trim();
  return `${before}${before ? "<div><br></div>" : ""}${signature}<div><br></div>${after}`;
};

const composeBody = (input: BuildOutgoingMessageInput): { html: string; text: string } => {
  const mode = input.mode ?? "new";
  const initialHtml = sanitizeRichText(input.bodyHtml ?? "").trim();
  const safeSignature = input.signature?.signatureHtml ? sanitizeRichText(input.signature.signatureHtml).trim() : "";
  let body = stripLegacySignatureArtifacts(initialHtml, safeSignature);

  if (safeSignature && signatureEnabledForMode(input.signature, mode)) {
    const block = signatureBlock(safeSignature);
    if (mode === "reply" || mode === "replyAll" || mode === "forward") {
      body = input.signature?.position === "afterQuotedText"
        ? `${body}${body ? "<div><br></div>" : ""}${block}`
        : insertBeforeQuotedHistory(body, block);
    } else {
      body = `${body}${body ? "<div><br></div>" : ""}${block}`;
    }
  }

  const html = body || "";
  const text = html ? richTextToPlainText(html) : (input.bodyText ?? "");
  return { html, text };
};

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
