-- Phase 1: additive, non-enforcing billing foundation.
-- A single migration transaction must snapshot all existing identities/workspaces.
-- Future users and workspaces default to false; no current permissions are altered.
BEGIN;
ALTER TABLE users ADD COLUMN IF NOT EXISTS legacy_free_for_life boolean NOT NULL DEFAULT false;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS legacy_free_for_life boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS billing_legacy_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_kind text NOT NULL CHECK (subject_kind IN ('user','organization')),
  subject_id text NOT NULL,
  reason text NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(subject_kind, subject_id)
);
INSERT INTO billing_legacy_grants (subject_kind, subject_id, reason)
  SELECT 'user', id, 'pre_billing_launch' FROM users
  ON CONFLICT (subject_kind,subject_id) DO NOTHING;
INSERT INTO billing_legacy_grants (subject_kind, subject_id, reason)
  SELECT 'organization', id::text, 'pre_billing_launch' FROM organizations
  ON CONFLICT (subject_kind,subject_id) DO NOTHING;
UPDATE users SET legacy_free_for_life = true
  WHERE id IN (SELECT subject_id FROM billing_legacy_grants WHERE subject_kind = 'user' AND reason = 'pre_billing_launch');
UPDATE organizations SET legacy_free_for_life = true
  WHERE id::text IN (SELECT subject_id FROM billing_legacy_grants WHERE subject_kind = 'organization' AND reason = 'pre_billing_launch');

CREATE TABLE IF NOT EXISTS billing_customers (
  organization_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  stripe_customer_id text UNIQUE NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS billing_subscriptions (
  organization_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  stripe_subscription_id text UNIQUE NOT NULL,
  status text NOT NULL,
  billing_interval text NOT NULL CHECK (billing_interval IN ('month','year')),
  mailbox_quantity integer NOT NULL DEFAULT 0 CHECK (mailbox_quantity >= 0),
  ai_quantity integer NOT NULL DEFAULT 0 CHECK (ai_quantity >= 0 AND ai_quantity <= mailbox_quantity),
  current_period_end timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS billing_processed_events (
  stripe_event_id text PRIMARY KEY,
  event_type text NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS billing_usage_monthly (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  bucket text NOT NULL,
  period_start date NOT NULL,
  used bigint NOT NULL DEFAULT 0 CHECK(used >= 0),
  PRIMARY KEY(organization_id,bucket,period_start)
);
COMMIT;
