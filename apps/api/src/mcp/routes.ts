import { randomUUID, createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import { verifyMcpBearer } from "./verifyBearer.js";
import { agentMailRegistry } from "../ai/tools/registry.js";
import { resolveMcpUserToolPermission } from "./resolvePermissions.js";
import { getAccessibleAccounts } from "../auth/authorize.js";
import { mcpBootstrapTools } from "./bootstrapTools.js";
import { discoverMcpCapabilities } from "./capabilityDiscovery.js";
import { mcpPrepareDraftRequest } from "./prepareDraftAction.js";
import { storePreparedMcpDraft } from "./draftPayloadStore.js";
import { canUseMcpWriteTestMode, mcpWriteCallPolicy } from "./writeTestPolicy.js";
import { reserveAiIdempotency, completeAiIdempotency, failAiIdempotency } from "../ai/agentState.js";

/** OAuth-scoped MCP transport with owner-only, explicitly enabled write testing. */
export async function mcpRoutes(app:FastifyInstance):Promise<void> {
  // Scope fallback parsing to MCP. Clients can probe with nonstandard media types before OAuth.
  app.addContentTypeParser("*", { parseAs: "string", bodyLimit: 1024 * 1024 }, (_request, body, done) => {
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
    // Stateless Streamable HTTP: JSON responses, no SSE or session ID.
    const origin=request.headers.origin;
    if(origin){
      try {
        const parsed=new URL(origin);
        if(parsed.protocol!=="https:" || !["chatgpt.com","chat.openai.com","claude.ai","api.guidedstepswellness.com","mail.guidedstepswellness.com"].includes(parsed.hostname))
          return reply.code(403).send({error:"origin_not_allowed"});
      }catch{return reply.code(403).send({error:"origin_not_allowed"});}
    }
    const writeTestEnabled=canUseMcpWriteTestMode({
      userId:identity.userId,enabled:process.env.GSW_MCP_WRITE_TEST_ENABLED,
      allowedUserId:process.env.GSW_MCP_WRITE_TEST_USER_ID,
    });
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
      return wrap({tools:[...mcpBootstrapTools.filter(t=>t.name!=="prepare_action" || process.env.GSW_MCP_PREPARE_ENABLED==="true"),{name:"invoke_tool",description:"Universal MCP dispatcher for every GSW Mail registry tool. Use list_capabilities to discover names, required OAuth scopes and risk. All actions enforce OAuth, GSW permissions and mailbox ACL at execution. Writes require the configured owner-only test mode and a fresh UUID requestId; external actions also require confirmExternal=true.",inputSchema:{type:"object",properties:{toolName:{type:"string",description:"Registered GSW tool name, dotted or double-underscore format"},accountId:{type:"string",description:"Authorized mailbox account UUID"},arguments:{type:"object",description:"Arguments matching the selected registered tool schema",additionalProperties:true},requestId:{type:"string",format:"uuid",description:"Required for writes; unique for each intended action"},confirmExternal:{type:"boolean",description:"Required true for explicitly authorized external effects"}},required:["toolName","accountId","arguments"],additionalProperties:false}},...agentMailRegistry.definitions().map(t=>({name:t.name.replaceAll(".","__"),description:t.description+(t.risk==="external"?" CAUTION: This action can send, publish, delete or trigger external effects. Set confirmExternal=true only after reviewing the exact intended effect.":""),inputSchema:{...t.inputSchema,properties:{...(t.inputSchema.properties as Record<string,unknown> ?? {}),accountId:{type:"string",description:"GSW mailbox account UUID to operate within"},...(t.risk!=="read"?{requestId:{type:"string",format:"uuid",description:"Fresh UUID per intended action; reuse for retries to prevent duplicate execution"},...(t.risk==="external"?{confirmExternal:{type:"boolean",description:"Set true only after explicit user authorization of this external action"}}:{})}:{})},required:[...((t.inputSchema.required as string[] | undefined) ?? []),"accountId",...(t.risk!=="read"?["requestId",...(t.risk==="external"?["confirmExternal"]:[])]:[])]}}))]});
    }
    if(input.method==="tools/call"){
      let name=typeof input.params?.name==="string"?input.params.name:"";
      const args=input.params?.arguments;
      let params=args&&typeof args==="object"&&!Array.isArray(args)?args as Record<string,unknown>:{};
      if(name==="invoke_tool") {
        const requestedName=typeof params.toolName==="string"?params.toolName:"";
        const nested=params.arguments;
        if(!agentMailRegistry.definition(requestedName) || !nested || typeof nested!=="object" || Array.isArray(nested)) {
          return wrap({isError:true,content:[{type:"text",text:JSON.stringify({error:"unknown_tool_or_invalid_arguments"})}]});
        }
        name=requestedName;
        params={...(nested as Record<string,unknown>),accountId:params.accountId,requestId:params.requestId,confirmExternal:params.confirmExternal};
      }
      if(name==="get_current_user") {
        return wrap({content:[{type:"text",text:JSON.stringify({userId:identity.userId})}]});
      }
      if(name==="list_capabilities") {
        try {
          const query=typeof params.query==="string"?params.query:undefined;
          const offset=typeof params.offset==="number"?params.offset:undefined;
          const limit=typeof params.limit==="number"?params.limit:undefined;
          const catalog=discoverMcpCapabilities(agentMailRegistry.definitions(),identity.oauthScopes,{
            ...(query!==undefined?{query}:{}),
            ...(offset!==undefined?{offset}:{}),
            ...(limit!==undefined?{limit}:{}),
            writeTestEnabled,
          });
          return wrap({content:[{type:"text",text:JSON.stringify(catalog)}]});
        } catch {
          return wrap({isError:true,content:[{type:"text",text:"Invalid capability discovery parameters"}]});
        }
      }
      if(name==="prepare_action") {
        // Disabled by default. Preparation is not draft creation or sending.
        if(process.env.GSW_MCP_PREPARE_ENABLED!=="true") {
          return wrap({isError:true,content:[{type:"text",text:JSON.stringify({error:"preparation_disabled"})}]});
        }
        const parsed=mcpPrepareDraftRequest.safeParse(params);
        if(!parsed.success) {
          return wrap({isError:true,content:[{type:"text",text:JSON.stringify({
            error:"invalid_proposal",issues:parsed.error.issues.map(issue=>({path:issue.path,message:issue.message}))
          })}]});
        }
        const proposal=parsed.data;
        const permission=await resolveMcpUserToolPermission({
          userId:identity.userId,accountId:proposal.accountId,
          oauthScopes:identity.oauthScopes,toolName:proposal.toolName,
        });
        if(!permission.allowed || permission.tool.risk!=="reversible_write") {
          return wrap({isError:true,content:[{type:"text",text:JSON.stringify({error:"permission_denied"})}]});
        }
        try {
          const approval=await storePreparedMcpDraft({
            userId:identity.userId,accountId:proposal.accountId,clientId:identity.clientId,
            argumentsValue:proposal.arguments,expiresAt:new Date(Date.now()+15*60_000),
          });
          return wrap({content:[{type:"text",text:JSON.stringify({
            approvalId:approval.id,status:approval.status,summary:approval.summary,
            expiresAt:approval.expiresAt,reviewLocation:"GSW Mail > Settings > Security > AI app approvals",
            draftCreated:false,emailSent:false,executionEnabled:false,
            message:"Proposal saved for first-party review only. No email draft has been created.",
          })}]});
        } catch {
          return wrap({isError:true,content:[{type:"text",text:JSON.stringify({error:"proposal_storage_unavailable"})}]});
        }
      }
      if(name==="list_accounts") {
        if(!identity.oauthScopes.has("mail.read")) return wrap({isError:true,content:[{type:"text",text:"mail.read scope required"}]});
        const accounts=(await getAccessibleAccounts(identity.userId))
          .filter(account=>account.permissions.includes("read"))
          .map(account=>({accountId:account.id,address:account.address,displayName:account.displayName,role:account.role}));
        return wrap({content:[{type:"text",text:JSON.stringify({accounts})}]});
      }
      const accountId=typeof params.accountId==="string"?params.accountId:"";
      const policy=await resolveMcpUserToolPermission({userId:identity.userId,accountId,oauthScopes:identity.oauthScopes,toolName:name});
      if(!policy.allowed)
        return wrap({isError:true,content:[{type:"text",text:JSON.stringify({error:"permission_denied",reason:policy.reason,tool:name})}]});
      if(policy.tool.risk!=="read"&&!writeTestEnabled)
        return wrap({isError:true,content:[{type:"text",text:JSON.stringify({error:"write_test_disabled",tool:name})}]});
      const {accountId:_,requestId,confirmExternal,...toolArguments}=params;
      const context={userId:identity.userId,authUserId:identity.authUserId,accountId,headers:{}};
      if(policy.tool.risk!=="read") {
        const decision=mcpWriteCallPolicy({
          risk:policy.tool.risk,requestId,confirmExternal,
          userId:identity.userId,clientId:identity.clientId,accountId,
          toolName:policy.tool.name,argumentsValue:toolArguments,
        });
        if(!decision.allowed) return wrap({isError:true,content:[{type:"text",text:JSON.stringify({error:decision.reason})}]});
        // One persistent reservation per user/client/requestId, bound to exact
        // tool, mailbox and canonical arguments. A repeated request never runs again.
        const hex=createHash("sha256").update(decision.digest).digest("hex");
        const actionFingerprintId=`${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-8${hex.slice(17,20)}-${hex.slice(20,32)}`;
        const reservation=await reserveAiIdempotency({
          key:decision.key,userId:identity.userId,accountId,
          toolName:policy.tool.name,toolCallId:null, fingerprint:actionFingerprintId,
          expiresAt:new Date(Date.now()+24*60*60_000),
        });
        if(reservation.reused) {
          const same=reservation.reservation.userId===identity.userId &&
            reservation.reservation.accountId===accountId &&
            reservation.reservation.toolName===policy.tool.name &&
            (reservation.reservation.result as { fingerprint?: string } | null)?.fingerprint===actionFingerprintId;
          return wrap({isError:!same||reservation.reservation.status!=="completed",
            content:[{type:"text",text:JSON.stringify(same&&reservation.reservation.status==="completed"
              ?{status:"already_completed",result:reservation.reservation.result}
              :{error:same?"request_already_attempted":"request_id_reused_with_different_action"})}]});
        }
        try {
          const result=await agentMailRegistry.execute(name,JSON.stringify(toolArguments),context,randomUUID());
          if(result.ok) {
            // Store only a completion marker; raw mail/file/contact results can be sensitive.
            await completeAiIdempotency(decision.key,{completed:true,fingerprint:actionFingerprintId});
          } else {
            await failAiIdempotency(decision.key,new Error(result.error?.code??"tool_failed"));
          }
          return wrap({isError:!result.ok,content:[{type:"text",text:JSON.stringify(result.ok?result.data:result.error).slice(0,50000)}]});
        } catch {
          await failAiIdempotency(decision.key,new Error("mcp_write_execution_failed"));
          return wrap({isError:true,content:[{type:"text",text:JSON.stringify({error:"write_execution_failed_check_action_status_before_retrying"})}]});
        }
      }
      const result=await agentMailRegistry.execute(name,JSON.stringify(toolArguments),context,randomUUID());
      return wrap({isError:!result.ok,content:[{type:"text",text:JSON.stringify(result.ok?result.data:result.error).slice(0,50000)}]});
    }
    return reply.code(200).send({jsonrpc:"2.0",id:input.id??null,error:{code:-32601,message:"Method not found"}});
  });
  app.get("/mcp",async (_request,reply)=>reply.code(405).header("Allow","POST").send());
  app.delete("/mcp",async (_request,reply)=>reply.code(405).header("Allow","POST").send());
}
