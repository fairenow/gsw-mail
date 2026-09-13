import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mergeImportedEmails, validateImportedEmails } from "./contactImport.js";

test("validates a large CSV-like email dataset", () => {
  const emails = validateImportedEmails(Array.from({ length: 693 }, (_, index) => ({ email: `person-${index + 1}@example.com` })));
  assert.equal(emails.length, 693);
  assert.equal(emails.at(-1)?.email, "person-693@example.com");
});

test("validates and deduplicates imported email addresses", () => {
  const emails = validateImportedEmails([
    { email: " person@example.com " },
    { email: "PERSON@example.com" },
    { email: "other@example.com" },
  ]);
  assert.deepEqual(emails.map((item) => item.email), ["person@example.com", "other@example.com"]);
});

test("reports malformed imported emails without affecting other rows", () => {
  const rows = ["valid@example.com", "not-an-email", "another@example.com"];
  const results = rows.map((email) => {
    try {
      validateImportedEmails([{ email }]);
      return "valid";
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  });
  assert.deepEqual(results, ["valid", "invalid email \"not-an-email\"", "valid"]);
});

test("merge behavior preserves existing emails and adds only new addresses", () => {
  const merged = mergeImportedEmails(
    [{ email: "existing@example.com" }],
    [{ email: "EXISTING@example.com" }, { email: "new@example.com" }],
  );
  assert.deepEqual(merged.map((item) => item.email), ["existing@example.com", "new@example.com"]);
});
