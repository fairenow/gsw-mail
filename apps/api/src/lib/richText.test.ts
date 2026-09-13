import assert from "node:assert/strict";
import test from "node:test";
import { richTextToPlainText, sanitizeRichText } from "./richText.js";

test("sanitizes rich text while preserving safe formatting", () => {
  const html = sanitizeRichText('<p style="color: red; position: fixed" onclick="bad()"><strong>Hello</strong> <a href="https://example.com">there</a><script>alert(1)</script></p>');
  assert.match(html, /<strong>Hello<\/strong>/);
  assert.match(html, /href="https:\/\/example.com"/);
  assert.doesNotMatch(html, /onclick|script|position/);
  assert.equal(richTextToPlainText(html), "Hello there");
});

test("removes unsafe links and image protocols", () => {
  const html = sanitizeRichText('<a href="javascript:alert(1)">bad</a><img src="https://example.com/image.png"><img src="data:text/html,bad">');
  assert.doesNotMatch(html, /javascript|data:text/);
  assert.match(html, /src="https:\/\/example.com\/image.png"/);
});
