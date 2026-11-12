-- GSW Mail Core: 5 GB storage allowance per mailbox, no price change.
-- Raise any smaller quota to the included minimum; keep custom quotas above 5 GB.
ALTER TABLE email_accounts ALTER COLUMN quota_bytes SET DEFAULT 5000000000;
UPDATE email_accounts SET quota_bytes = 5000000000 WHERE quota_bytes IS NULL OR quota_bytes < 5000000000;
