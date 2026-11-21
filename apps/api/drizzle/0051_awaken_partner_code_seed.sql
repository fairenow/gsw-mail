-- One-time Awaken Network partner code seed.
-- Plaintext is deliberately never checked into Git. This is the SHA-256 digest
-- of a 128-bit randomly generated, lowercase hexadecimal redemption token.
-- This migration is applied by the Railway deployment migration runner.
INSERT INTO billing_partner_codes (partner_key, code_hash)
VALUES ('AWAKEN_LIFETIME_MAILBOX', '111bce402311d272bd996196ead48061ad9003ad438d6171080a10bd5ce227f8')
ON CONFLICT (code_hash) DO NOTHING;
