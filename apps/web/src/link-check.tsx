import { useState } from "react";
import { createRoot } from "react-dom/client";
import { RichTextEditor } from "./components/RichTextEditor";
import { normalizeLinkUrl, sanitizeHtml, richTextToText } from "./lib/richText";
import "./styles/globals.css";
import "./styles/mail.css";
import "./styles/product.css";
const checks: string[] = [];
const check = (name: string, pass: boolean) => checks.push(`${pass ? "PASS" : "FAIL"}: ${name}`);
const parse = (html: string) => new DOMParser().parseFromString(html, "text/html");
const labeled = sanitizeHtml('<div><a href="https://example.com/?a=1&amp;b=2">Book a visit</a></div>');
check("Labeled links retain destination and text", parse(labeled).querySelector("a")?.getAttribute("href") === "https://example.com/?a=1&b=2" && parse(labeled).querySelector("a")?.textContent === "Book a visit");
check("Plain pasted URLs become links", parse(sanitizeHtml('<div>Visit https://example.com/test and www.example.com.</div>')).querySelectorAll("a").length === 2);
check("HTTPS is added to bare domains", normalizeLinkUrl("example.com/path") === "https://example.com/path");
check("Unsafe links inside unsupported wrappers are removed", !/javascript:|onclick|onerror|<script/.test(sanitizeHtml('<section><a href="javascript:alert(1)" onclick="bad()">Bad</a><img src="x" onerror="bad()"><script>bad()</script></section>')));
check("Repeated sanitization preserves destinations", sanitizeHtml(labeled) === labeled);
check("Plain text retains hidden link destinations", richTextToText(labeled) === "Book a visit (https://example.com/?a=1&b=2)");
function Harness() {
 const [html, setHtml] = useState(labeled);
 return <main style={{padding: 24}}><h1>Hyperlink verification</h1><pre>{checks.join("\n")}</pre><RichTextEditor value={html} onChange={setHtml} /><h2>Reader preview</h2><div className="gsw-reading-body" dangerouslySetInnerHTML={{__html: sanitizeHtml(html)}} /><h2>Saved HTML</h2><pre style={{whiteSpace:"pre-wrap"}}>{sanitizeHtml(html)}</pre></main>;
}
createRoot(document.getElementById("root")!).render(<Harness />);
