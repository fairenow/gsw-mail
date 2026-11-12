-- GSW Mail Core: 5 GB storage allowance per mailbox, no price change.
-- Preserve explicit mailbox-specific quotas; fill only unspecified quotas.
ALTER TABLE email_accounts ALTER COLUMN quota_bytes SET DEFAULT 5000000000;
UPDATE email_accounts SET quota_bytes = 5000000000 WHERE quota_bytes IS NULL;
