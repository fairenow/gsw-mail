import assert from "node:assert/strict";
import test from "node:test";
import { isActiveAdminMembership } from "./adminPolicy.js";

test("active workspace owner and admin can discover admin resources", () => {
  assert.equal(isActiveAdminMembership({ role: "owner", status: "active" }), true);
  assert.equal(isActiveAdminMembership({ role: "admin", status: "active" }), true);
});
test("non-admin and inactive roles are denied", () => {
  for (const role of ["member", "viewer", "delegate", ""]) {
    assert.equal(isActiveAdminMembership({ role, status: "active" }), false);
  }
  for (const status of ["invited", "disabled", "suspended", ""]) {
    assert.equal(isActiveAdminMembership({ role: "owner", status }), false);
    assert.equal(isActiveAdminMembership({ role: "admin", status }), false);
  }
});
