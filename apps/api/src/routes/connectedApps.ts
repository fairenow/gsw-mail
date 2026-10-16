import { and, desc, eq, inArray } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { requireUser } from "../auth/middleware.js";
import { db } from "../db/client.js";
import { requireOrgPermission } from "../auth/authorize.js";
import { auditEvents, users, organizationMemberships, oauthClient, oauthConsent, oauthAccessToken, oauthRefreshToken } from "../db/schema.js";

/**
 * User-owned OAuth connections, sourced directly from Better Auth records.
 * Never return raw token values, client secrets, or private OAuth metadata.
 */
export default async function connectedAppRoutes(app:FastifyInstance) {
  await requireUser(app, { optional:false });

  app.get("/api/account/connected-apps", async (req,reply) => {
    if(!req.authUserId) return reply.code(403).send({error:"auth_identity_required"});
    const consents=await db.select({
      id:oauthConsent.id,clientId:oauthConsent.clientId,scopes:oauthConsent.scopes,
      createdAt:oauthConsent.createdAt,updatedAt:oauthConsent.updatedAt,
      clientName:oauthClient.name,clientUri:oauthClient.uri,clientDisabled:oauthClient.disabled,
    }).from(oauthConsent).innerJoin(oauthClient,eq(oauthConsent.clientId,oauthClient.clientId))
      .where(eq(oauthConsent.userId,req.authUserId));
    const refresh=await db.select({
      clientId:oauthRefreshToken.clientId,expiresAt:oauthRefreshToken.expiresAt,
      revoked:oauthRefreshToken.revoked,
    }).from(oauthRefreshToken).where(eq(oauthRefreshToken.userId,req.authUserId));
    const now=Date.now();
    return {connections:consents.map(c=>({
      consentId:c.id,clientId:c.clientId,name:c.clientName??"Unnamed application",
      website:c.clientUri,scopes:c.scopes,approvedAt:c.createdAt,updatedAt:c.updatedAt,
      disabled:c.clientDisabled===true,
      activeRefreshAuthorization:refresh.some(r=>r.clientId===c.clientId&&!r.revoked&&r.expiresAt.getTime()>now),
    }))};
  });

  app.get("/api/account/connected-apps/activity", async (req,reply) => {
    if(!req.authUserId)return reply.code(403).send({error:"auth_identity_required"});
    const events=await db.select({action:auditEvents.action,resourceId:auditEvents.resourceId,createdAt:auditEvents.createdAt,metadata:auditEvents.metadata})
      .from(auditEvents).where(and(eq(auditEvents.actorUserId,req.user!.id),eq(auditEvents.resourceType,"oauth_connection")))
      .orderBy(desc(auditEvents.createdAt)).limit(100);
    return {events};
  });

  app.get<{Querystring:{organizationId:string}}>("/api/admin/oauth-clients",async(req,reply)=>{
    const organizationId=req.query.organizationId;
    if(!organizationId)return reply.code(400).send({error:"organization_required"});
    await requireOrgPermission(req.user!.id,organizationId,["owner","admin"]);
    const members=await db.select({authUserId:users.authUserId}).from(organizationMemberships)
      .innerJoin(users,eq(organizationMemberships.userId,users.id))
      .where(and(eq(organizationMemberships.organizationId,organizationId),eq(organizationMemberships.status,"active")));
    const ids=members.map(m=>m.authUserId).filter((id):id is string=>Boolean(id));
    if(!ids.length)return {clients:[]};
    const rows=await db.select({clientId:oauthClient.clientId,name:oauthClient.name,website:oauthClient.uri,disabled:oauthClient.disabled,
      scopes:oauthConsent.scopes,approvedAt:oauthConsent.createdAt}).from(oauthConsent)
      .innerJoin(oauthClient,eq(oauthConsent.clientId,oauthClient.clientId))
      .where(inArray(oauthConsent.userId,ids));
    return {clients:rows};
  });

  app.delete<{Params:{clientId:string}}>("/api/account/connected-apps/:clientId", async (req,reply) => {
    const userId=req.authUserId;
    if(!userId) return reply.code(403).send({error:"auth_identity_required"});
    const clientId=req.params.clientId;
    if(!clientId || clientId.length>256) return reply.code(400).send({error:"invalid_client_id"});
    const result=await db.transaction(async tx=>{
      const authorized=await tx.select({id:oauthConsent.id}).from(oauthConsent)
        .where(and(eq(oauthConsent.userId,userId),eq(oauthConsent.clientId,clientId)));
      if(!authorized.length)return false;
      await tx.delete(oauthAccessToken).where(and(eq(oauthAccessToken.userId,userId),eq(oauthAccessToken.clientId,clientId)));
      await tx.delete(oauthRefreshToken).where(and(eq(oauthRefreshToken.userId,userId),eq(oauthRefreshToken.clientId,clientId)));
      await tx.delete(oauthConsent).where(and(eq(oauthConsent.userId,userId),eq(oauthConsent.clientId,clientId)));
      await tx.insert(auditEvents).values({actorUserId:req.user!.id,action:"oauth.connection.disconnected",resourceType:"oauth_connection",resourceId:clientId,metadata:{source:"connected_apps"}});
      return true;
    });
    if(!result)return reply.code(404).send({error:"connection_not_found"});
    // Important: DB deletion does not immediately revoke already-issued signed JWTs.
    return {disconnected:true,warning:"MCP checks current consent on each request. Other OAuth resource services may continue accepting previously issued signed tokens until expiration."};
  });
}
