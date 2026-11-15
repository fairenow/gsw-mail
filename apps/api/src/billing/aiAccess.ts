import { hasFounderSubscriptionExemption } from "./founderAccess.js";
import { pool } from "../db/client.js";
import { requireAccountPermission } from "../auth/authorize.js";
import { forbidden } from "../lib/errors.js";
export async function hasAiSubscription(userId: string, accountId?: string): Promise<boolean> {
  const organizationId = accountId ? (await requireAccountPermission(userId, accountId, "read")).organizationId : null;
  if (await hasFounderSubscriptionExemption(userId, organizationId)) return true;
  const { rows } = await pool.query<{ allowed: boolean }>(
    `SELECT EXISTS(SELECT 1 FROM billing_subscriptions s JOIN organization_memberships m ON m.organization_id=s.organization_id JOIN users u ON u.id=m.user_id WHERE m.user_id=$1 AND m.org_membership_status='active' AND u.user_status='active' AND ($2::uuid IS NULL OR s.organization_id=$2) AND s.status IN ('active','trialing') AND s.ai_quantity>0 AND s.current_period_end>now()) AS allowed`,
    [userId, organizationId],
  );
  return rows[0]?.allowed === true;
}
export async function requireAiSubscription(userId: string, accountId?: string) {
  if (!(await hasAiSubscription(userId, accountId))) throw forbidden("An active AI subscription is required. Upgrade from workspace billing to use Chat.");
}
