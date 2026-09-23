const allowedTags = new Set([
  "A", "B", "BLOCKQUOTE", "BR", "CENTER", "CODE", "DIV", "EM", "FONT", "H1", "H2", "H3", "H4", "H5", "H6", "HR", "I", "IMG", "LI", "OL", "P", "PRE", "SECTION", "SMALL", "SPAN", "STRONG", "SUB", "SUP", "TABLE", "TBODY", "TD", "TFOOT", "TH", "THEAD", "TR", "U", "UL",
]);
const allowedAttributes = new Set([
  "align", "alt", "border", "cellpadding", "cellspacing", "color", "colspan", "face", "height", "href", "rel", "rowspan", "size", "src", "style", "target", "title", "valign", "width",
]);

const safeStyleProperty = /^(?:background(?:-color)?|border(?:-(?:top|right|bottom|left))?(?:-(?:color|style|width))?|border-collapse|border-radius|box-sizing|color|display|float|font(?:-family|-size|-style|-weight)?|height|letter-spacing|line-height|margin(?:-(?:top|right|bottom|left))?|max-height|max-width|min-height|min-width|overflow|padding(?:-(?:top|right|bottom|left))?|text-align|text-decoration|text-indent|text-transform|vertical-align|white-space|width|word-break|word-wrap)\s*:/i;

export function sanitizeRichText(input: string): string {
  return input
    .replace(/<(script|iframe|object|embed|form)[\s\S]*?<\/\1>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<\/?([a-z0-9]+)(?:\s[^>]*)?>/gi, (tag, name: string) => {
      const upper = name.toUpperCase();
      if (!allowedTags.has(upper)) return "";
      if (tag.startsWith("</")) return `</${name.toLowerCase()}>`;
      const attrs = [...tag.matchAll(/([a-zA-Z_:][\w:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)]
        .slice(1)
        .map((match) => {
          const key = match[1]!.toLowerCase();
          const value = match[2] ?? match[3] ?? match[4] ?? "";
          if (key === "class") {
            return value.split(/\s+/).includes("gsw-signature") ? ' class="gsw-signature"' : "";
          }
          if (!allowedAttributes.has(key) || key.startsWith("on")) return "";
          if ((key === "href" || key === "src") && !/^(https?:|mailto:|cid:|data:image\/(?:png|gif|jpeg|webp);base64,)/i.test(value)) return "";
          if (key === "style") {
            const safeStyle = value
              .split(";")
              .map((declaration) => declaration.trim())
              .filter((declaration) => safeStyleProperty.test(declaration) && !/url\s*\(|expression\s*\(|javascript:/i.test(declaration))
              .join("; ");
            return safeStyle ? ` style="${escapeAttribute(safeStyle)}"` : "";
          }
          return ` ${key}="${escapeAttribute(value)}"`;
        })
        .join("");
      return `<${name.toLowerCase()}${attrs}>`;
    });
}

export function hasRemoteMailImages(input: string): boolean {
  return /<img\b[^>]*\bsrc\s*=\s*(?:"https?:|'https?:|https?:)/i.test(input);
}

export function sanitizeInboundMailHtml(input: string): string {
  // Incoming mail is untrusted. Preserve the layout primitives that real email
  // clients rely on (tables, spacing, typography and inline borders), while
  // removing executable content and remote image loads that can track opens.
  return sanitizeRichText(input).replace(/<img\b[^>]*\bsrc="https?:[^"]*"[^>]*>/gi, "");
}

export function richTextToPlainText(input: string): string {
  return input
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/p\s*>|<\/div\s*>|<\/li\s*>|<\/tr\s*>/gi, "\n")
    .replace(/<\/td\s*>|<\/th\s*>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function escapeAttribute(value: string): string {
  return value.replace(/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);)/gi, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
