export function normalizeLinkUrl(input: string): string | null {
  const value = input.trim();
  if (!value || /[\s<>"']/.test(value)) return null;
  const candidate = value.startsWith("//") ? `https:${value}` : /^(?:https?:|mailto:)/i.test(value) ? value : /^[^/:]+\.[^/:]+(?::\d+)?(?:[/?#]|$)/.test(value) ? `https://${value}` : "";
  try {
    const url = new URL(candidate);
    return ["http:", "https:"].includes(url.protocol) && url.hostname || url.protocol === "mailto:" && url.pathname ? candidate : null;
  } catch { return null; }
}

function linkifyTextNodes(doc: Document) {
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  for (const node of nodes) {
    if (node.parentElement?.closest("a")) continue;
    const text = node.textContent ?? "";
    const pattern = /\b(?:https?:\/\/|www\.)[^\s<>"']+/gi;
    const fragment = doc.createDocumentFragment();
    let end = 0;
    for (const match of text.matchAll(pattern)) {
      let label = match[0].replace(/[.,!?;:]+$/, "");
      while (label.endsWith(")") && label.split(")").length > label.split("(").length) label = label.slice(0, -1);
      const href = normalizeLinkUrl(label);
      if (!href) continue;
      fragment.append(text.slice(end, match.index));
      const link = doc.createElement("a");
      link.href = href; link.textContent = label; link.target = "_blank"; link.rel = "noopener noreferrer";
      fragment.append(link);
      end = match.index! + label.length;
    }
    if (end) { fragment.append(text.slice(end)); node.replaceWith(fragment); }
  }
}

const tags = new Set(["A", "B", "BLOCKQUOTE", "BR", "CENTER", "CODE", "DIV", "EM", "FONT", "H1", "H2", "H3", "H4", "H5", "H6", "HR", "I", "IMG", "LI", "OL", "P", "PRE", "SECTION", "SMALL", "SPAN", "STRONG", "SUB", "SUP", "TABLE", "TBODY", "TD", "TFOOT", "TH", "THEAD", "TR", "U", "UL"]);
const safeStyleProperty = /^(?:background(?:-color)?|border(?:-(?:top|right|bottom|left))?(?:-(?:color|style|width))?|border-collapse|border-radius|box-sizing|color|display|float|font(?:-family|-size|-style|-weight)?|height|letter-spacing|line-height|margin(?:-(?:top|right|bottom|left))?|max-height|max-width|min-height|min-width|overflow|padding(?:-(?:top|right|bottom|left))?|text-align|text-decoration|text-indent|text-transform|vertical-align|white-space|width|word-break|word-wrap)\s*:/i;

export function sanitizeHtml(input: string): string {
  const doc = new DOMParser().parseFromString(input, "text/html");
  doc.querySelectorAll("script,style,iframe,object,embed,form").forEach((node) => node.remove());
  const walk = (node: Node) => {
    [...node.childNodes].forEach((child) => {
      if (child.nodeType !== Node.ELEMENT_NODE) return;
      const element = child as HTMLElement;
      if (!tags.has(element.tagName)) { walk(element); child.replaceWith(...[...child.childNodes]); return; }
      [...element.attributes].forEach((attribute) => {
        const name = attribute.name.toLowerCase();
        const value = attribute.value;
        if (name === "class") {
          const signatureClass = value.split(/\s+/).includes("gsw-signature");
          if (signatureClass) element.setAttribute("class", "gsw-signature");
          else element.removeAttribute("class");
          return;
        }
        if (name === "href") {
          const href = normalizeLinkUrl(value);
          if (href) element.setAttribute("href", href);
          else element.removeAttribute("href");
          return;
        }
        const safeUrl = /^(https?:|mailto:|cid:|data:image\/(?:png|gif|jpeg|webp);base64,)/i.test(value);
        if (name.startsWith("on") || !["align", "alt", "border", "cellpadding", "cellspacing", "color", "colspan", "face", "height", "href", "rel", "rowspan", "size", "src", "style", "target", "title", "valign", "width"].includes(name) || ((name === "href" || name === "src") && !safeUrl)) element.removeAttribute(attribute.name);
        if (name === "style") element.setAttribute("style", value.split(";").map((part) => part.trim()).filter((part) => safeStyleProperty.test(part) && !/url\s*\(|expression\s*\(|javascript:/i.test(part)).join(";"));
      });
      if (element.tagName === "A") { element.setAttribute("target", "_blank"); element.setAttribute("rel", "noopener noreferrer"); }
      walk(element);
    });
  };
  walk(doc.body);
  linkifyTextNodes(doc);
  return doc.body.innerHTML;
}

export function richTextToText(input: string): string {
  const doc = new DOMParser().parseFromString(input, "text/html");
  doc.querySelectorAll("a[href]").forEach((link) => {
    const href = normalizeLinkUrl(link.getAttribute("href") ?? "");
    if (href && link.textContent?.trim() !== href) link.append(` (${href})`);
  });
  doc.querySelectorAll("br").forEach((node) => node.replaceWith("\n"));
  doc.querySelectorAll("p,div,li,tr").forEach((node) => node.append("\n"));
  doc.querySelectorAll("td,th").forEach((node) => node.append(" "));
  return (doc.body.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim();
}

export function plainTextToHtml(input: string): string {
  return input.split(/\n/).map((line) => `<div>${line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") || "<br>"}</div>`).join("");
}
