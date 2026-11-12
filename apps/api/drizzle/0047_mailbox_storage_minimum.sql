-- Ensure every mailbox includes at least 5 GB while preserving higher custom quotas.
-- Separate forward-only migration: 0046 was already applied and must remain immutable.
ALTER TABLE email_accounts ALTER COLUMN quota_bytes SET DEFAULT 5000000000;
UPDATE email_accounts
SET quota_bytes = 5000000000
WHERE quota_bytes IS NULL OR quota_bytes < 5000000000;
