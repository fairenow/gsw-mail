-- Forward-only, additive mailbox billing entitlement policy.
-- Every customer workspace includes one lifetime-free mailbox.
-- Operator-owned workspaces below retain an explicit unlimited mailbox exception.
-- Do not change existing mailbox contents, subscriptions or historical legacy flags.
CREATE TABLE IF NOT EXISTS billing_mailbox_exemptions (
  organization_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  reason text NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now()
);

-- Verify the administrator owns the workspace; do not exempt by a matching
-- email string alone without an authenticated product-user/owner relationship.
INSERT INTO billing_mailbox_exemptions (organization_id, reason)
SELECT DISTINCT om.organization_id, 'founder_operator_exception'
FROM users u
JOIN organization_memberships om ON om.user_id = u.id
WHERE lower(u.email) IN (
  'ramon.williams.jr@gmail.com',
  '24hrautollc@gmail.com'
)
AND u.auth_user_id IS NOT NULL
AND om.org_membership_role = 'owner'
AND om.org_membership_status = 'active'
ON CONFLICT (organization_id) DO NOTHING;
