import { pool } from "../db/client.js";
export async function hasFounderSubscriptionExemption(userId: string, organizationId?: string | null): Promise<boolean> {
  const { rows } = await pool.query<{ allowed: boolean }>(
    `SELECT EXISTS(
      SELECT 1 FROM billing_mailbox_exemptions e
      JOIN organization_memberships actor ON actor.organization_id=e.organization_id
      JOIN users current_user_record ON current_user_record.id=actor.user_id
      JOIN organization_memberships ownership ON ownership.organization_id=e.organization_id
      JOIN users founder ON founder.id=ownership.user_id
      WHERE actor.user_id=$1 AND actor.org_membership_status='active' AND current_user_record.user_status='active'
      AND ($2::uuid IS NULL OR e.organization_id=$2) AND e.reason='founder_operator_exception'
      AND ownership.org_membership_role='owner' AND ownership.org_membership_status='active'
      AND founder.user_status='active' AND founder.auth_user_id IS NOT NULL
      AND lower(founder.email) IN ('ramon.williams.jr@gmail.com','24hrautollc@gmail.com')
    ) AS allowed`, [userId, organizationId ?? null],
  );
  return rows[0]?.allowed === true;
}
