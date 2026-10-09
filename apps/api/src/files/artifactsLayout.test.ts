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
