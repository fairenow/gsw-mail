import { describe, expect, it } from "vitest";
import { templateKeyAllowedForAddress, userHasBrandedTemplateAccess } from "./templatePolicy.js";

describe("template domain policy", () => {
  it("allows no-template for every domain", () => {
    expect(templateKeyAllowedForAddress("none", "user@example.com")).toBe(true);
  });

  it("limits branded templates to team.guidedstepswellness.com", () => {
    expect(templateKeyAllowedForAddress("gsw_default", "ramon@team.guidedstepswellness.com")).toBe(true);
    expect(templateKeyAllowedForAddress("bible_reader", "ramon@team.guidedstepswellness.com")).toBe(true);
    expect(templateKeyAllowedForAddress("gsw_default", "user@example.com")).toBe(false);
  });

  it("detects branded access from accessible mailbox addresses", () => {
    expect(userHasBrandedTemplateAccess(["user@example.com", "member@team.guidedstepswellness.com"])).toBe(true);
    expect(userHasBrandedTemplateAccess(["user@example.com"])).toBe(false);
  });
});
