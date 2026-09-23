const allowedTags = new Set([
  "A", "B", "BLOCKQUOTE", "BR", "DIV", "EM", "FONT", "H1", "H2", "H3", "I", "IMG", "LI", "OL", "P", "SPAN", "STRONG", "U", "UL",
]);
const allowedAttributes = new Set(["align", "color", "face", "href", "rel", "size", "src", "style", "target", "title", "width"]);

export function sanitizeRichText(input: string): string {
  return input
    .replace(/<(script|style|iframe|object|embed|form)[\s\S]*?<\/\1>/gi, "")
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
          if ((key === "href" || key === "src") && !/^(https?:|mailto:|data:image\/(?:png|gif|jpeg|webp);base64,)/i.test(value)) return "";
          if (key === "style") {
            const safeStyle = value
              .split(";")
              .map((declaration) => declaration.trim())
              .filter((declaration) => /^(color|background-color|font-size|font-family|font-weight|font-style|text-align|text-decoration)\s*:/i.test(declaration) && !/url\s*\(|expression\s*\(/i.test(declaration))
              .join("; ");
            return safeStyle ? ` style="${escapeAttribute(safeStyle)}"` : "";
          }
          return ` ${key}="${escapeAttribute(value)}"`;
        })
        .join("");
      return `<${name.toLowerCase()}${attrs}>`;
    });
}

export function richTextToPlainText(input: string): string {
  return input
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/p\s*>|<\/div\s*>|<\/li\s*>/gi, "\n")
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
