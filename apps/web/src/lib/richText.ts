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

const tags = new Set(["A", "B", "BLOCKQUOTE", "BR", "DIV", "EM", "FONT", "H1", "H2", "H3", "I", "IMG", "LI", "OL", "P", "SPAN", "STRONG", "U", "UL"]);

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
        const safeUrl = /^(https?:|mailto:|data:image\/(?:png|gif|jpeg|webp);base64,)/i.test(value);
        if (name.startsWith("on") || !["align", "color", "face", "href", "rel", "size", "src", "style", "target", "title", "width"].includes(name) || ((name === "href" || name === "src") && !safeUrl)) element.removeAttribute(attribute.name);
        if (name === "style") element.setAttribute("style", value.split(";").filter((part) => /^(color|background-color|font-size|font-family|font-weight|font-style|text-align|text-decoration)\s*:/i.test(part) && !/url\s*\(|expression\s*\(/i.test(part)).join(";"));
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
  doc.querySelectorAll("p,div,li").forEach((node) => node.append("\n"));
  return (doc.body.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim();
}

export function plainTextToHtml(input: string): string {
  return input.split(/\n/).map((line) => `<div>${line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") || "<br>"}</div>`).join("");
}

