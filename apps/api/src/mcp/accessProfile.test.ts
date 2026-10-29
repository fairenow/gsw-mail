import { additionalAdminTools, adminToolRisk } from "./adminTools.js";
import { mcpBootstrapTools } from "./bootstrapTools.js";
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

test("every admin scope has exposed tools and all reject mailbox connections",()=>{
  const tools=mcpBootstrapTools.filter(tool=>tool.name.includes("admin_"));
  for(const scope of adminScopes) assert.ok(tools.some(tool=> (tool.requiredScopes as readonly string[]).includes(scope)),scope);
  for(const tool of tools) {
    assert.equal(toolAllowedForMode("admin",tool.name,tool.requiredScopes),true,tool.name);
    assert.equal(toolAllowedForMode("mailbox",tool.name,tool.requiredScopes),false,tool.name);
    if(adminToolRisk(tool.name)!=="read") {
      assert.ok("required" in tool.inputSchema && (tool.inputSchema.required as readonly string[]).includes("requestId"),tool.name);
      assert.ok("required" in tool.inputSchema && (tool.inputSchema.required as readonly string[]).includes("confirmExternal"),tool.name);
    }
  }
  assert.ok(additionalAdminTools.length>=10);
});
