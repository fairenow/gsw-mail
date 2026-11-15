import { requireAccountPermission } from "../auth/authorize.js";
import { pool } from "../db/client.js";
import { forbidden } from "../lib/errors.js";
import { hasPaidMeetingAccess } from "./entitlement.js";
export const OPERATOR_MEETING_QUERY = `
 SELECT u.email,(u.auth_user_id IS NOT NULL) AS authenticated,(u.user_status='active') AS active,
 EXISTS(SELECT 1 FROM organization_memberships m WHERE m.user_id=u.id AND m.organization_id=$2 AND m.org_membership_role='owner' AND m.org_membership_status='active') AS owner,
 EXISTS(SELECT 1 FROM billing_mailbox_exemptions e WHERE e.organization_id=$2 AND e.reason='founder_operator_exception') AS exempt
 FROM users u WHERE u.id=$1`;
export function operatorMeetingAccess(
  row:
    | {
        email: string;
        authenticated: boolean;
        active: boolean;
        owner: boolean;
        exempt: boolean;
      }
    | undefined,
) {
  return (
    !!row &&
    row.authenticated &&
    row.active &&
    row.owner &&
    row.exempt &&
    ["ramon.williams.jr@gmail.com", "24hrautollc@gmail.com"].includes(
      row.email.toLowerCase(),
    )
  );
}
export async function meetingOrganizer(
  userId: string,
  accountId: string,
  requirePaid = true,
) {
  const account = await requireAccountPermission(userId, accountId, "manage");
  if (account.status !== "active") throw forbidden("meeting_account_inactive");
  const { rows } = await pool.query<{
    status: string;
    mailbox_quantity: number;
    current_period_end: Date | null;
  }>(
    "SELECT status,mailbox_quantity,current_period_end FROM billing_subscriptions WHERE organization_id=$1",
    [account.organizationId],
  );
  const operator = await pool.query<{
    email: string;
    authenticated: boolean;
    active: boolean;
    owner: boolean;
    exempt: boolean;
  }>(OPERATOR_MEETING_QUERY, [userId, account.organizationId]);
  const videoMeetings =
    hasPaidMeetingAccess(rows[0]) || operatorMeetingAccess(operator.rows[0]);
  if (requirePaid && !videoMeetings)
    throw forbidden("meeting_entitlement_required");
  return { userId, workspaceId: account.organizationId, videoMeetings };
}
