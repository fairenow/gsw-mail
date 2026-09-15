import { useEffect, useRef, useState, type MouseEvent } from "react";

import { normalizeLinkUrl, plainTextToHtml, sanitizeHtml } from "../lib/richText";
export { plainTextToHtml, richTextToText, sanitizeHtml } from "../lib/richText";

export function RichTextEditor({ value, onChange, placeholder, minHeight = 180 }: { value: string; onChange: (value: string) => void; placeholder?: string; minHeight?: number }) {
  const [linkInput, setLinkInput] = useState<string | null>(null);
  const [linkError, setLinkError] = useState("");
  const linkRange = useRef<Range | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (ref.current && ref.current.innerHTML !== value) ref.current.innerHTML = sanitizeHtml(value); }, [value]);
  const update = () => onChange(ref.current?.innerHTML ?? "");
  const command = (name: string, valueArg?: string) => { ref.current?.focus(); document.execCommand(name, false, valueArg); update(); };
  const insertLink = () => {
    const selection = window.getSelection();
    linkRange.current = selection?.rangeCount && ref.current?.contains(selection.anchorNode) ? selection.getRangeAt(0).cloneRange() : null;
    setLinkInput(""); setLinkError("");
  };
  const applyLink = () => {
    const href = normalizeLinkUrl(linkInput ?? "");
    if (!href) { setLinkError("Enter a valid website URL or mailto: address."); return; }
    ref.current?.focus();
    const range = linkRange.current;
    const selection = window.getSelection();
    if (range) { selection?.removeAllRanges(); selection?.addRange(range); }
    if (range && !range.collapsed) command("createLink", href);
    else {
      const link = document.createElement("a"); link.href = href; link.textContent = linkInput!.trim();
      command("insertHTML", sanitizeHtml(link.outerHTML));
    }
    setLinkInput(null);
  };
  const openLink = (event: MouseEvent<HTMLDivElement>) => {
    const link = (event.target as HTMLElement).closest("a[href]");
    const href = normalizeLinkUrl(link?.getAttribute("href") ?? "");
    if (href) { event.preventDefault(); window.open(href, "_blank", "noopener,noreferrer"); }
  };
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
      <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={insertLink}>Link</button>
      <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => command("hiliteColor", "#fff0bd")}>Highlight</button>
      <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => { const url = window.prompt("Image URL"); if (url) command("insertImage", url); }}>Image</button>
      <select aria-label="Font size" defaultValue="3" onChange={(event) => command("fontSize", event.target.value)}><option value="2">Small</option><option value="3">Normal</option><option value="4">Large</option><option value="5">Huge</option></select>
      <input aria-label="Text color" type="color" defaultValue="#2d2923" onChange={(event) => command("foreColor", event.target.value)} />
      <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => command("removeFormat")}>Clear</button>
    </div>
    {linkInput !== null && <div className="gsw-link-entry" role="group" aria-label="Insert link">
      <input autoFocus aria-label="Link URL" placeholder="https://example.com" value={linkInput} onChange={(event) => setLinkInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); applyLink(); } if (event.key === "Escape") { event.preventDefault(); setLinkInput(null); ref.current?.focus(); } }} />
      <button type="button" onClick={applyLink}>Apply link</button>
      <button type="button" onClick={() => { setLinkInput(null); ref.current?.focus(); }}>Cancel</button>
      {linkError && <span role="alert">{linkError}</span>}
    </div>}
    <div ref={ref} className="gsw-rich-content" contentEditable suppressContentEditableWarning data-placeholder={placeholder} style={{ minHeight }} onInput={update} onPaste={paste} onClick={openLink} role="textbox" aria-multiline="true" />
  </div>;
}
