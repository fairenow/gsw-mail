import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { FastifyRequest } from "fastify";
import { db, pingDatabase } from "../db/client.js";
import { aliases, auditEvents, domains, emailAccounts, organizationMemberships, users } from "../db/schema.js";
import { requireOrgPermission } from "../auth/authorize.js";
import { provisionDomainInfrastructure, verifyDomainInfrastructure } from "../lib/domainInfrastructure.js";
import { deleteAdminMailbox, deleteAdminUser } from "../services/adminDeletion.js";
import { badRequest, conflict, notFound } from "../lib/errors.js";
import { audit } from "../lib/audit.js";
import { config } from "../config.js";
import { getRelay } from "../outbound/relay.js";

const uuid = { type:"string",format:"uuid" };
const organization = { organizationId:uuid };
const confirmation = { requestId:uuid,confirmExternal:{type:"boolean",description:"Explicit user authorization of this exact change."} };
function definition(name:string,description:string,scope:string,properties:Record<string,unknown>={},required:string[]=[],write=false) {
  return {name,description,requiredScopes:[scope],inputSchema:{type:"object",properties:{...organization,...properties,...(write?confirmation:{})},required:["organizationId",...required,...(write?["requestId","confirmExternal"]:[])],additionalProperties:false}};
}
export const additionalAdminTools = [
  definition("list_admin_users","List users, active roles and membership status within an administered workspace.","workspace.read"),
  definition("get_admin_health","Read database and outbound relay health for an administered workspace.","admin.health.read"),
  definition("list_admin_audit","Read paginated administrative audit events within an administered workspace.","admin.audit.read",{limit:{type:"integer",minimum:1,maximum:100},offset:{type:"integer",minimum:0}}),
  definition("create_admin_domain","Connect and provision a domain in an administered workspace. May create mail-provider configuration; requires explicit confirmation.","domain.write",{domain:{type:"string",maxLength:253}},["domain"],true),
  definition("verify_admin_domain","Verify a workspace domain and refresh its stored DNS verification state.","domain.write",{domainId:uuid},["domainId"],true),
  definition("list_admin_aliases","List alias routing metadata for all domains in an administered workspace.","alias.read"),
  definition("create_admin_alias","Create an alias routing to a mailbox in the same workspace. Requires explicit confirmation.","alias.write",{domainId:uuid,source:{type:"string",maxLength:128},targetAccountId:uuid},["domainId","source","targetAccountId"],true),
  definition("delete_admin_alias","Delete an alias routing entry. Read the alias first and confirm its exact address.","alias.write",{aliasId:uuid,confirmation:{type:"string"}},["aliasId","confirmation"],true),
  definition("delete_admin_mailbox","Permanently delete a mailbox and its mail-server account. Confirm its exact address. Workspace-owner and own mailbox protections apply.","mailbox_admin.write",{accountId:uuid,confirmation:{type:"string"}},["accountId","confirmation"],true),
  definition("delete_admin_user","Remove a user and mailbox grants from this workspace, preserving other workspaces. Confirm the exact user email. Delete or reassign owned mailboxes first; owner and self protections apply.","workspace.admin",{userId:{type:"string"},confirmation:{type:"string"}},["userId","confirmation"],true),
];
export function adminToolRisk(name:string):"read"|"external" {
  return /^(list|get)_admin_/.test(name)?"read":"external";
}
const base = z.object({organizationId:z.string().uuid()});
export async function executeAdditionalAdminTool(name:string, params:Record<string,unknown>, actor:{userId:string;authUserId:string;request:FastifyRequest}) {
  const {organizationId} = base.parse(params);
  await requireOrgPermission(actor.userId,organizationId,["owner","admin"]);
  if(name==="list_admin_users") return {organizationId,users:await db.select({id:users.id,email:users.email,name:users.name,status:users.status,role:organizationMemberships.role,membershipStatus:organizationMemberships.status}).from(organizationMemberships).innerJoin(users,eq(users.id,organizationMemberships.userId)).where(eq(organizationMemberships.organizationId,organizationId))};
  if(name==="get_admin_health") return {organizationId,db:await pingDatabase()?"ok":"down",mailEngine:config.mailEngine,outboundRelay:getRelay().name};
  if(name==="list_admin_audit") {
    const input=base.extend({limit:z.number().int().min(1).max(100).default(50),offset:z.number().int().min(0).max(100000).default(0)}).parse(params);
    return {organizationId,events:await db.select().from(auditEvents).where(eq(auditEvents.organizationId,organizationId)).orderBy(desc(auditEvents.createdAt)).limit(input.limit).offset(input.offset)};
  }
  if(name==="delete_admin_mailbox") return deleteAdminMailbox(actor,z.string().uuid().parse(params.accountId),params);
  if(name==="delete_admin_user") return deleteAdminUser(actor,z.string().min(1).max(256).parse(params.userId),params);
  if(name==="create_admin_domain") {
    const domainName=z.string().trim().toLowerCase().regex(/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/).parse(params.domain);
    const [existing]=await db.select().from(domains).where(eq(domains.name,domainName)).limit(1);
    if(existing && existing.organizationId!==organizationId) throw conflict("domain already belongs to another workspace");
    const [domain]=existing?[existing]:await db.insert(domains).values({organizationId,name:domainName,status:"pending"}).returning();
    if(!domain) throw new Error("domain_creation_failed");
    const infrastructure=await provisionDomainInfrastructure(domain.id,domain.name);
    const verification=await verifyDomainInfrastructure(domain.id,domain.name);
    await audit({actorUserId:actor.userId,organizationId,action:"domain.created",resourceType:"domain",resourceId:domain.id,request:actor.request});
    return {domainId:domain.id,name:domain.name,infrastructure,verification};
  }
  if(name==="verify_admin_domain") {
    const domainId=z.string().uuid().parse(params.domainId);
    const [domain]=await db.select().from(domains).where(and(eq(domains.id,domainId),eq(domains.organizationId,organizationId))).limit(1);
    if(!domain) throw notFound("domain not found");
    return verifyDomainInfrastructure(domain.id,domain.name);
  }
  if(name==="list_admin_aliases") return {organizationId,aliases:await db.select({id:aliases.id,domainId:aliases.domainId,domain:domains.name,source:aliases.source,targetAccountId:aliases.targetAccountId}).from(aliases).innerJoin(domains,eq(domains.id,aliases.domainId)).where(eq(domains.organizationId,organizationId))};
  if(name==="create_admin_alias") {
    const input=base.extend({domainId:z.string().uuid(),source:z.string().trim().regex(/^[a-z0-9._%+-]{1,128}$/i),targetAccountId:z.string().uuid()}).parse(params);
    const [domain]=await db.select().from(domains).where(and(eq(domains.id,input.domainId),eq(domains.organizationId,organizationId))).limit(1);
    const [target]=await db.select().from(emailAccounts).where(and(eq(emailAccounts.id,input.targetAccountId),eq(emailAccounts.workspaceId,organizationId))).limit(1);
    if(!domain || !target) throw notFound("workspace domain or target mailbox not found");
    const [existing]=await db.select({id:aliases.id}).from(aliases).where(and(eq(aliases.domainId,input.domainId),eq(aliases.source,input.source))).limit(1);
    if(existing) throw conflict("alias already exists");
    const [created]=await db.insert(aliases).values({domainId:input.domainId,source:input.source,targetAccountId:input.targetAccountId}).returning();
    await audit({actorUserId:actor.userId,organizationId,action:"alias.created",resourceType:"alias",resourceId:created?.id ?? null,request:actor.request});
    return {alias:created,resolvesTo:target.address};
  }
  if(name==="delete_admin_alias") {
    const aliasId=z.string().uuid().parse(params.aliasId);
    const [alias]=await db.select({id:aliases.id,source:aliases.source,domain:domains.name}).from(aliases).innerJoin(domains,eq(domains.id,aliases.domainId)).where(and(eq(aliases.id,aliasId),eq(domains.organizationId,organizationId))).limit(1);
    if(!alias) throw notFound("alias not found");
    if(params.confirmation!==`${alias.source}@${alias.domain}`) throw badRequest("Confirm exact alias address");
    await db.delete(aliases).where(eq(aliases.id,alias.id));
    await audit({actorUserId:actor.userId,organizationId,action:"alias.deleted",resourceType:"alias",resourceId:alias.id,request:actor.request});
    return {deleted:true,id:alias.id};
  }
  throw badRequest("unknown admin tool");
}
