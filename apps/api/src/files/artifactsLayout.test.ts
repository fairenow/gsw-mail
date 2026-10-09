import assert from "node:assert/strict";
import { test } from "node:test";
import { composePdfHtml } from "./artifacts.js";

test("preserves full styled HTML instead of nesting it", () => {
  const html = '<!doctype html><html><head><meta charset="utf-8"><style>.hero{background:#123456;color:white}</style></head><body><header class="hero">Ministry report</header></body></html>';
  const output = composePdfHtml(html);
  assert.equal((output.match(/<html/gi) ?? []).length, 1);
  assert.match(output, /background:#123456/);
  assert.match(output, /print-color-adjust: exact/);
  assert.match(output, /Ministry report/);
});
test("supports the reusable report component styles", () => {
  const output = composePdfHtml("# Outreach report\n\n15 emails sent");
  assert.match(output, /gsw-report-hero/);
  assert.match(output, /gsw-metrics/);
  assert.match(output, /gsw-two-col/);
  assert.match(output, /<h1>Outreach report<\/h1>/);
});

test("GSW:TC report styles include feature grids and print color preservation", () => {
  const output = composePdfHtml('<!doctype html><html><head></head><body class="gsw-tc"><section class="gsw-feature-grid"><article class="gsw-feature-card"><h3>Mailbox</h3></article></section></body></html>');
  assert.match(output, /#41865b/);
  assert.match(output, /#f4e8cd/);
  assert.match(output, /gsw-feature-grid/);
  assert.match(output, /break-inside: avoid/);
  assert.equal((output.match(/<html/gi) ?? []).length, 1);
});

test("inserts safe printable margins after model styling and avoids a footer-only overflow", () => {
  const html = '<!doctype html><html><head><style>@page{margin:0}.gsw-report-hero{margin:-70px}</style></head><body class="gsw-tc"><header class="gsw-report-hero">Title</header><footer class="gsw-report-footer">End</footer></body></html>';
  const output = composePdfHtml(html);
  assert.match(output, /@page \{ size: Letter; margin: 14mm 15mm !important; \}/);
  assert.match(output, /page-break-inside: avoid !important/);
  assert.ok(output.indexOf("14mm 15mm !important") > output.indexOf("@page{margin:0}"), "safe print CSS must follow authored styles");
  assert.equal((output.match(/<style>/g) ?? []).length, 2);
});

test("branded service overviews override a model-authored fixed-height cover", () => {
  const html = '<!doctype html><html><head><style>.cover{height:100vh;page-break-after:always}</style></head><body class="gsw-tc"><section class="cover"><header class="gsw-report-hero">Hero</header><div class="gsw-metrics">Metrics</div></section><section>Platform overview</section></body></html>';
  const output = composePdfHtml(html);
  assert.match(output, /\.gsw-tc \.cover, \.gsw-tc \.cover-page/);
  assert.match(output, /break-after: auto !important; page-break-after: auto !important/);
  assert.ok(output.lastIndexOf("page-break-after: auto !important") > output.indexOf("page-break-after:always"));
});
