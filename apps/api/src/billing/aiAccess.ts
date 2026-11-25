import { hasFounderSubscriptionExemption } from "./founderAccess.js";
import { pool } from "../db/client.js";
import { requireAccountPermission } from "../auth/authorize.js";
import { forbidden } from "../lib/errors.js";
type SubscriptionRow={status:string|null;ai_quantity:number|null;current_period_end:Date|null;current:boolean};
export function classifyAiEntitlement(exempt:boolean,rows:SubscriptionRow[]){
 const paid=rows.find(r=>r.current&&(r.status==="active"||r.status==="trialing")&&(r.ai_quantity??0)>0);
 const row=paid??rows[0];
 return {allowed:exempt||Boolean(paid),source:exempt?"founder_exemption" as const:paid?"subscription" as const:"none" as const,subscriptionStatus:row?.status??null,aiSeats:row?.ai_quantity??0,currentPeriodEnd:row?.current_period_end?.toISOString()??null};
}
export async function getAiEntitlement(userId:string,accountId?:string){
 const organizationId=accountId?(await requireAccountPermission(userId,accountId,"read")).organizationId:null;
 const exempt=await hasFounderSubscriptionExemption(userId,organizationId);
 const {rows}=await pool.query<SubscriptionRow>(
  `SELECT s.status,s.ai_quantity,s.current_period_end,COALESCE(s.current_period_end>now(),false) AS current
  FROM organization_memberships m JOIN users u ON u.id=m.user_id LEFT JOIN billing_subscriptions s ON s.organization_id=m.organization_id
  WHERE m.user_id=$1 AND m.org_membership_status='active' AND u.user_status='active' AND ($2::uuid IS NULL OR m.organization_id=$2)
  ORDER BY s.current_period_end DESC NULLS LAST`,[userId,organizationId]);
 return classifyAiEntitlement(exempt,rows);
}
export async function hasAiSubscription(userId:string,accountId?:string){return (await getAiEntitlement(userId,accountId)).allowed;}
export async function requireAiSubscription(userId:string,accountId?:string){
 if(!(await hasAiSubscription(userId,accountId)))throw forbidden("An active AI subscription is required. Upgrade from workspace billing to use Chat.");
}
