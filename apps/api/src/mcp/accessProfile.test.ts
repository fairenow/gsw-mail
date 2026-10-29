import assert from "node:assert/strict";
import test from "node:test";
import { aiScopes } from "../ai/permissions/types.js";
import { permissionDescriptions } from "./permissionDescriptions.js";
import { selectMcpAccountMode, scopeAllowedForMode, toolAllowedForMode, adminScopes } from "./accessProfile.js";
test("mailbox identity cannot become an admin connection through a legacy owner role", () => {
  assert.equal(selectMcpAccountMode(true,true),"mailbox");
  assert.equal(selectMcpAccountMode(false,true),"admin");
  assert.equal(selectMcpAccountMode(false,false),"identity");
});
test("every product permission has one mode and a clear description", () => {
  for (const scope of aiScopes) {
    assert.ok((permissionDescriptions[scope]?.length ?? 0) > 30, scope);
    assert.notEqual(scopeAllowedForMode("admin",scope),scopeAllowedForMode("mailbox",scope),scope);
    assert.equal(scopeAllowedForMode("identity",scope),false,scope);
  }
});
test("admin tools and mailbox tools reject the opposite account type regardless of OAuth grants", () => {
  for (const name of ["list_admin_workspaces","list_admin_domains","list_admin_mailboxes","create_admin_mailbox"]) assert.equal(toolAllowedForMode("mailbox",name),false);
  for (const scope of adminScopes) assert.equal(toolAllowedForMode("mailbox","registry_tool",[scope]),false);
  assert.equal(toolAllowedForMode("admin","mail__read",["mail.read"]),false);
  assert.equal(toolAllowedForMode("admin","invoke_tool"),false);
  assert.equal(toolAllowedForMode("identity","list_accounts",["mail.read"]),false);
  assert.equal(toolAllowedForMode("admin","list_admin_domains",["domain.read"]),true);
  assert.equal(toolAllowedForMode("mailbox","mail__read",["mail.read"]),true);
});
test("baseline identity and legacy automation permissions are classified explicitly", () => {
  for (const mode of ["admin","mailbox","identity"] as const) assert.equal(scopeAllowedForMode(mode,"openid"),true);
  assert.equal(scopeAllowedForMode("admin","automation.write"),false);
  assert.equal(scopeAllowedForMode("mailbox","automation.write"),true);
  assert.equal(scopeAllowedForMode("mailbox","unknown.write"),false);
});
