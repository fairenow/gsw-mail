import assert from "node:assert/strict";
import test from "node:test";
import { safeFilename } from "./attachments.js";

test("attachment filenames cannot inject response headers", () => {
  assert.equal(safeFilename('report"\r\nX-Test: injected.pdf'), "report__X-Test: injected.pdf");
  assert.equal(safeFilename("\\unsafe\\name.txt"), "_unsafe_name.txt");
});

test("attachment filename falls back when empty", () => {
  assert.equal(safeFilename("\r\n"), "attachment");
});
