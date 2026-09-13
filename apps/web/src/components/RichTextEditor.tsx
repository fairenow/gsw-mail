import { useEffect, useRef } from "react";

const tags = new Set(["A", "B", "BLOCKQUOTE", "BR", "DIV", "EM", "FONT", "H1", "H2", "H3", "I", "IMG", "LI", "OL", "P", "SPAN", "STRONG", "U", "UL"]);

export function sanitizeHtml(input: string): string {
  const doc = new DOMParser().parseFromString(input, "text/html");
  doc.querySelectorAll("script,style,iframe,object,embed,form").forEach((node) => node.remove());
  const walk = (node: Node) => {
    [...node.childNodes].forEach((child) => {
      if (child.nodeType !== Node.ELEMENT_NODE) return;
      const element = child as HTMLElement;
      if (!tags.has(element.tagName)) { child.replaceWith(...[...child.childNodes]); return; }
      [...element.attributes].forEach((attribute) => {
        const name = attribute.name.toLowerCase();
        const value = attribute.value;
        const safeUrl = /^(https?:|mailto:|data:image\/(?:png|gif|jpeg|webp);base64,)/i.test(value);
        if (name.startsWith("on") || !["align", "color", "face", "href", "rel", "size", "src", "style", "target", "title", "width"].includes(name) || ((name === "href" || name === "src") && !safeUrl)) element.removeAttribute(attribute.name);
        if (name === "style") element.setAttribute("style", value.split(";").filter((part) => /^(color|background-color|font-size|font-family|font-weight|font-style|text-align|text-decoration)\s*:/i.test(part) && !/url\s*\(|expression\s*\(/i.test(part)).join(";"));
      });
      if (element.tagName === "A") { element.setAttribute("target", "_blank"); element.setAttribute("rel", "noopener noreferrer"); }
      walk(element);
    });
  };
  walk(doc.body);
  return doc.body.innerHTML;
}

export function richTextToText(input: string): string {
  const doc = new DOMParser().parseFromString(input, "text/html");
  doc.querySelectorAll("br").forEach((node) => node.replaceWith("\n"));
  doc.querySelectorAll("p,div,li").forEach((node) => node.append("\n"));
  return (doc.body.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim();
}

export function plainTextToHtml(input: string): string {
  return input.split(/\n/).map((line) => `<div>${line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") || "<br>"}</div>`).join("");
}

export function RichTextEditor({ value, onChange, placeholder, minHeight = 180 }: { value: string; onChange: (value: string) => void; placeholder?: string; minHeight?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (ref.current && ref.current.innerHTML !== value) ref.current.innerHTML = value; }, [value]);
  const update = () => onChange(sanitizeHtml(ref.current?.innerHTML ?? ""));
  const command = (name: string, valueArg?: string) => { ref.current?.focus(); document.execCommand(name, false, valueArg); update(); };
  const paste = (event: React.ClipboardEvent<HTMLDivElement>) => { event.preventDefault(); const html = event.clipboardData.getData("text/html"); const text = event.clipboardData.getData("text/plain"); document.execCommand("insertHTML", false, sanitizeHtml(html || plainTextToHtml(text))); update(); };
  return <div className="gsw-rich-editor">
    <div className="gsw-rich-toolbar" role="toolbar" aria-label="Formatting">
      <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => command("bold")}><strong>B</strong></button>
      <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => command("italic")}><em>I</em></button>
      <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => command("underline")}><u>U</u></button>
      <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => command("insertUnorderedList")}>• List</button>
      <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => command("insertOrderedList")}>1. List</button>
      <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => command("justifyLeft")}>Left</button>
      <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => command("justifyCenter")}>Center</button>
      <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => { const url = window.prompt("Link URL"); if (url) command("createLink", url); }}>Link</button>
      <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => command("hiliteColor", "#fff0bd")}>Highlight</button>
      <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => { const url = window.prompt("Image URL"); if (url) command("insertImage", url); }}>Image</button>
      <select aria-label="Font size" defaultValue="3" onChange={(event) => command("fontSize", event.target.value)}><option value="2">Small</option><option value="3">Normal</option><option value="4">Large</option><option value="5">Huge</option></select>
      <input aria-label="Text color" type="color" defaultValue="#2d2923" onChange={(event) => command("foreColor", event.target.value)} />
      <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => command("removeFormat")}>Clear</button>
    </div>
    <div ref={ref} className="gsw-rich-content" contentEditable suppressContentEditableWarning data-placeholder={placeholder} style={{ minHeight }} onInput={update} onPaste={paste} role="textbox" aria-multiline="true" />
  </div>;
}
