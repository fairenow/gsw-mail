import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { mcpRoutes } from "./routes.js";

test("MCP returns OAuth resource metadata challenge for unauthenticated POST",async()=>{
 const previous=process.env.GSW_MCP_ENABLED;
 const previousResource=process.env.GSW_MCP_RESOURCE_URL;
 process.env.GSW_MCP_ENABLED="true";
 process.env.GSW_MCP_RESOURCE_URL="https://api.guidedstepswellness.com/mcp";
 const app=Fastify();
 try{
  await app.register(mcpRoutes);
  const response=await app.inject({method:"POST",url:"/mcp",headers:{"content-type":"application/json",accept:"application/json, text/event-stream"},payload:{jsonrpc:"2.0",id:1,method:"initialize",params:{protocolVersion:"2025-11-25",capabilities:{},clientInfo:{name:"test",version:"1"}}}});
  assert.equal(response.statusCode,401);
  assert.match(String(response.headers["www-authenticate"]),/Bearer resource_metadata="https:\/\/api\.guidedstepswellness\.com\/\.well-known\/oauth-protected-resource\/mcp"/);
  for(const mediaType of ["application/octet-stream","application/x-mcp-probe"]){
    const probe=await app.inject({
      method:"POST",url:"/mcp",
      headers:{"content-type":mediaType,accept:"application/json, text/event-stream"},
      payload:JSON.stringify({jsonrpc:"2.0",id:2,method:"initialize"}),
    });
    assert.equal(probe.statusCode,401,`MCP probe ${mediaType} must challenge OAuth, not return 415`);
    assert.match(String(probe.headers["www-authenticate"]),/Bearer resource_metadata=/);
  }
  const get=await app.inject({method:"GET",url:"/mcp"});
  assert.equal(get.statusCode,405);
 }finally{
  await app.close();
  if(previous===undefined)delete process.env.GSW_MCP_ENABLED;else process.env.GSW_MCP_ENABLED=previous;
  if(previousResource===undefined)delete process.env.GSW_MCP_RESOURCE_URL;else process.env.GSW_MCP_RESOURCE_URL=previousResource;
 }
});


test("admin scope upgrades use OAuth challenges and full admin discovery stays separate",async()=>{
  const previous=process.env.GSW_MCP_ENABLED;
  const previousWrites=process.env.GSW_MCP_ADMIN_WRITES_ENABLED;
  const previousResource=process.env.GSW_MCP_RESOURCE_URL;
  process.env.GSW_MCP_RESOURCE_URL="https://api.guidedstepswellness.com/mcp";
  process.env.GSW_MCP_ENABLED="true";
  process.env.GSW_MCP_ADMIN_WRITES_ENABLED="true";
  const {adminScopes}=await import("./accessProfile.js");
  let grants=new Set(["openid"]);
  let mode:"admin"|"mailbox"="admin";
  const app=Fastify();
  await app.register(mcpRoutes,{
    verifyBearer:async()=>({userId:"admin-test-user",authUserId:"admin-auth",clientId:"client",oauthScopes:new Set(grants)}),
    resolveProfile:async()=>({mode,allowedScopes:["openid",...adminScopes]}),
  });
  const call=(method:string,params?:Record<string,unknown>)=>app.inject({method:"POST",url:"/mcp",headers:{authorization:"Bearer test"},payload:{jsonrpc:"2.0",id:1,method,...(params?{params}:{})}});
  try {
    const missing=await call("tools/list");
    assert.equal(missing.statusCode,403);
    assert.match(String(missing.headers["www-authenticate"]),/insufficient_scope/);
    assert.ok(String(missing.headers["www-authenticate"]).includes('resource_metadata="https://api.guidedstepswellness.com/.well-known/oauth-protected-resource/mcp"'));
    assert.match(String(missing.headers["www-authenticate"]),/workspace.read/);
    assert.match(String(missing.headers["www-authenticate"]),/domain.write/);
    grants=new Set(["openid",...adminScopes]);
    const response=await call("tools/list");
    assert.equal(response.statusCode,200);
    const tools=response.json().result.tools as {name:string}[];
    assert.ok(tools.some(tool=>tool.name==="delete_admin_user"));
    assert.ok(tools.some(tool=>tool.name==="create_admin_domain"));
    assert.ok(tools.some(tool=>tool.name==="create_admin_mailbox"));
    assert.equal(tools.some(tool=>tool.name.startsWith("mail__")||tool.name==="invoke_tool"),false);
    const denied=await call("tools/call",{name:"create_admin_domain",arguments:{organizationId:"c1111111-1111-4111-8111-111111111111",domain:"example.test",requestId:"c2222222-2222-4222-8222-222222222222",confirmExternal:false}});
    assert.match(denied.body,/explicit_external_confirmation_required/);
    mode="mailbox";
    const mailbox=await call("tools/call",{name:"delete_admin_user",arguments:{}});
    assert.match(mailbox.body,/account_type_not_allowed/);
    grants=new Set(["openid","workspace.read"]);
    mode="admin";
    const missingWrite=await call("tools/call",{name:"create_admin_domain",arguments:{}});
    assert.equal(missingWrite.statusCode,403);
    assert.match(String(missingWrite.headers["www-authenticate"]),/domain.write/);
  } finally {
    await app.close();
    if(previous===undefined)delete process.env.GSW_MCP_ENABLED;else process.env.GSW_MCP_ENABLED=previous;
    if(previousWrites===undefined)delete process.env.GSW_MCP_ADMIN_WRITES_ENABLED;else process.env.GSW_MCP_ADMIN_WRITES_ENABLED=previousWrites;
    if(previousResource===undefined)delete process.env.GSW_MCP_RESOURCE_URL;else process.env.GSW_MCP_RESOURCE_URL=previousResource;
  }
});
