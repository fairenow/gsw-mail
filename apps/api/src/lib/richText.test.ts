import assert from "node:assert/strict";
import test from "node:test";
import { hasRemoteMailImages, richTextToPlainText, sanitizeInboundMailHtml, sanitizeRichText } from "./richText.js";

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

test("preserves link labels and query parameters across draft and send sanitization", () => {
  const input = '<a href="https://example.com/book?a=1&amp;b=2" target="_blank" rel="noopener noreferrer">Book a visit</a>';
  const draft = sanitizeRichText(input);
  assert.equal(draft, input);
  assert.equal(sanitizeRichText(draft), input);
  assert.match(sanitizeRichText('<a href="https://example.com/?a=1&b=2">Full link</a>'), /a=1&amp;b=2/);
});

test("inbound mail HTML blocks remote images while preserving inline images", () => {
  const input = '<div onclick="bad()"><strong>Hello</strong><img src="https://tracker.example/open.gif"><img src="data:image/png;base64,aGVsbG8="><script>alert(1)</script></div>';
  assert.equal(hasRemoteMailImages(input), true);
  const html = sanitizeInboundMailHtml(input);
  assert.match(html, /<strong>Hello<\/strong>/);
  assert.match(html, /data:image\/png;base64,aGVsbG8=/);
  assert.doesNotMatch(html, /tracker\.example|onclick|script/);
});

test("remote-image detection ignores inline images and ordinary links", () => {
  assert.equal(hasRemoteMailImages('<p><a href="https://example.com">Visit</a><img src="data:image/gif;base64,R0lGODlhAQABAIAAAAUEBA=="></p>'), false);
  assert.equal(hasRemoteMailImages('<IMG alt="pixel" SRC=https://tracker.example/p.gif>'), true);
});
