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
