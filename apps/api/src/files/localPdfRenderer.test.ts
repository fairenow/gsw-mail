import assert from "node:assert/strict";
import { test } from "node:test";
import { validatePrintableHtml } from "./localPdfRenderer.js";

test("permits an ordinary styled print document", () => {
  assert.doesNotThrow(() => validatePrintableHtml('<!doctype html><html><head><meta charset="utf-8"><style>body { color: #333; }</style></head><body><h1>Report</h1><p>Details</p></body></html>'));
});

test("rejects executable and external PDF content", () => {
  assert.throws(() => validatePrintableHtml('<script>alert(1)</script>'));
  assert.throws(() => validatePrintableHtml('<img src="file:///etc/passwd">'));
  assert.throws(() => validatePrintableHtml('<div style="background:url(https://example.org/image.png)">x</div>'));
  assert.throws(() => validatePrintableHtml('<div onclick="run()">x</div>'));
});

test("supports embedded raster images but rejects remote image loading", () => {
  assert.doesNotThrow(() => validatePrintableHtml('<img alt="Logo" src="data:image/png;base64,aGVsbG8=">'));
  assert.throws(() => validatePrintableHtml('<img src="https://example.com/logo.png">'));
});
