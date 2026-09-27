import { strict as assert } from "node:assert";
import { test } from "node:test";
import { templateKeyAllowedForAddress, userHasBrandedTemplateAccess } from "./templatePolicy.js";

test("allows no-template for every domain", () => {
  assert.equal(templateKeyAllowedForAddress("none", "user@example.com"), true);
});

test("limits branded templates to team.guidedstepswellness.com", () => {
  assert.equal(templateKeyAllowedForAddress("gsw_default", "ramon@team.guidedstepswellness.com"), true);
  assert.equal(templateKeyAllowedForAddress("bible_reader", "ramon@team.guidedstepswellness.com"), true);
  assert.equal(templateKeyAllowedForAddress("gsw_default", "user@example.com"), false);
});

test("detects branded access from accessible mailbox addresses", () => {
  assert.equal(userHasBrandedTemplateAccess(["user@example.com", "member@team.guidedstepswellness.com"]), true);
  assert.equal(userHasBrandedTemplateAccess(["user@example.com"]), false);
});
