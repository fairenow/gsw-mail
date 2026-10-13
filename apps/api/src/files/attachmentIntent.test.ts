import { test } from "node:test";
import { strict as assert } from "node:assert";
import { shouldPreAnalyzeAttachments } from "./attachmentIntent.js";

test("recognizes the uploaded CSV failure reproduction", () => {
  assert.equal(shouldPreAnalyzeAttachments("Tell me what this csv file is about"), true);
});
test("recognizes spreadsheet and file analysis requests", () => {
  for (const prompt of ["Review this XLSX workbook", "Can you read this document?", "Analyze this file", "Summarize this spreadsheet"]) {
    assert.equal(shouldPreAnalyzeAttachments(prompt), true, prompt);
  }
});
test("does not inspect an unrelated greeting", () => {
  assert.equal(shouldPreAnalyzeAttachments("Hello, how are you?"), false);
});
