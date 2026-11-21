-- Partner-specific mailbox entitlements; never alter existing grandfathered grants.
CREATE TABLE IF NOT EXISTS billing_partner_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_key text NOT NULL CHECK (partner_key = 'AWAKEN_LIFETIME_MAILBOX'),
  code_hash text NOT NULL UNIQUE,
  redeemed_organization_id uuid UNIQUE REFERENCES organizations(id) ON DELETE SET NULL,
  redeemed_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS billing_partner_grants (
  organization_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  partner_key text NOT NULL CHECK (partner_key = 'AWAKEN_LIFETIME_MAILBOX'),
  code_id uuid NOT NULL UNIQUE REFERENCES billing_partner_codes(id),
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS billing_partner_codes_partner_key_idx ON billing_partner_codes(partner_key);

-- A grandfathered/partner mailbox can purchase an AI add-on without purchasing Core again.
ALTER TABLE billing_subscriptions DROP CONSTRAINT IF EXISTS billing_subscriptions_ai_quantity_check;
ALTER TABLE billing_subscriptions ADD CONSTRAINT billing_subscriptions_ai_quantity_nonnegative CHECK (ai_quantity >= 0);
