import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import { verifyMcpBearer } from "./verifyBearer.js";
import { agentMailRegistry } from "../ai/tools/registry.js";
import { resolveMcpUserToolPermission } from "./resolvePermissions.js";

/** Read-only transport while persisted write approvals are under construction. */
export async function mcpRoutes(app:FastifyInstance):Promise<void> {
  // Scope the parser to MCP. Some clients probe using octet-stream before OAuth.
  app.addContentTypeParser("application/octet-stream", { parseAs: "string", bodyLimit: 1024 * 1024 }, (_request, body, done) => {
    try { done(null, JSON.parse(body as string)); }
    catch { done(null, null); }
  });
  app.post("/mcp",async(request,reply)=>{
    if(process.env.GSW_MCP_ENABLED!=="true")return reply.code(503).send({error:"mcp_disabled"});
    const authorization=request.headers.authorization;
    const identity=authorization?.startsWith("Bearer ")?
      await verifyMcpBearer(authorization.slice(7)):null;
    if(!identity){
      const metadataUrl = new URL("/.well-known/oauth-protected-resource/mcp", process.env.GSW_MCP_RESOURCE_URL ?? `${config.auth.baseUrl.replace(/\/$/, "")}/mcp`).toString();
      return reply.code(401)
        .header("WWW-Authenticate", `Bearer resource_metadata="${metadataUrl}"`)
        .send({error:"unauthorized"});
    }
    // The server supports stateless Streamable HTTP: JSON responses, no SSE
    // notification stream and no session ID. It never enables write tools.
    const origin=request.headers.origin;
    if(origin){
      try {
        const parsed=new URL(origin);
        if(parsed.protocol!=="https:" || !["chatgpt.com","chat.openai.com","claude.ai","api.guidedstepswellness.com","mail.guidedstepswellness.com"].includes(parsed.hostname))
          return reply.code(403).send({error:"origin_not_allowed"});
      }catch{return reply.code(403).send({error:"origin_not_allowed"});}
    }
    const input=request.body as {jsonrpc?:string;id?:number|string;method?:string;params?:Record<string,unknown>};
    if(!input || input.jsonrpc!=="2.0")return reply.code(400).send({error:"invalid_jsonrpc"});
    const wrap=(result:unknown)=>({jsonrpc:"2.0",id:input.id??null,result});
    if(input.method==="initialize"){
      const offered=typeof input.params?.protocolVersion==="string"?input.params.protocolVersion:"2025-03-26";
      const version=["2025-03-26","2025-06-18","2025-11-25"].includes(offered)?offered:"2025-11-25";
      return wrap({protocolVersion:version,capabilities:{tools:{listChanged:false}},serverInfo:{name:"GSW Mail",version:"0.1"}});
    }
    if(input.method==="notifications/initialized")return reply.code(202).send();
    if(input.method==="ping")return wrap({});
    if(input.method==="resources/list")return wrap({resources:[]});
    if(input.method==="prompts/list")return wrap({prompts:[]});
    if(input.method==="tools/list"){
      return wrap({tools:agentMailRegistry.definitions().filter(t=>t.risk==="read"&&t.requiredScopes.every(s=>identity.oauthScopes.has(s))).map(t=>({name:t.name.replaceAll(".","__"),description:t.description,inputSchema:{...t.inputSchema,properties:{...(t.inputSchema.properties as Record<string,unknown> ?? {}),accountId:{type:"string",description:"GSW mailbox account UUID to operate within"}},required:[...((t.inputSchema.required as string[] | undefined) ?? []),"accountId"]}}))});
    }
    if(input.method==="tools/call"){
      const name=typeof input.params?.name==="string"?input.params.name:"";
      const args=input.params?.arguments;
      const params=args&&typeof args==="object"&&!Array.isArray(args)?args as Record<string,unknown>:{};
      const accountId=typeof params.accountId==="string"?params.accountId:"";
      const policy=await resolveMcpUserToolPermission({userId:identity.userId,accountId,oauthScopes:identity.oauthScopes,toolName:name});
      if(!policy.allowed||policy.tool.risk!=="read")return wrap({isError:true,content:[{type:"text",text:"Permission denied or write action disabled"}]});
      const {accountId:_,...toolArguments}=params;
      const result=await agentMailRegistry.execute(name,JSON.stringify(toolArguments),{userId:identity.userId,authUserId:identity.authUserId,accountId,headers:{}},randomUUID());
      return wrap({isError:!result.ok,content:[{type:"text",text:JSON.stringify(result.ok?result.data:result.error).slice(0,50000)}]});
    }
    return reply.code(200).send({jsonrpc:"2.0",id:input.id??null,error:{code:-32601,message:"Method not found"}});
  });
  app.get("/mcp",async (_request,reply)=>reply.code(405).header("Allow","POST").send());
  app.delete("/mcp",async (_request,reply)=>reply.code(405).header("Allow","POST").send());
}
