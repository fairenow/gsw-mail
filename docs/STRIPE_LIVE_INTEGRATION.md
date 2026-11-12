# GSW Mail — Stripe live-account integration

The Stripe code is deliberately disabled by default with STRIPE_CHECKOUT_ENABLED=false until credentials and the four Price IDs are set, tax behavior is decided, signed webhooks are verified, and controlled tests pass. Do not commit secrets to GitHub or browser-accessible Vercel variables.

## Railway variables (placeholder values)

| Name | Placeholder |
| --- | --- |
| STRIPE_SECRET_KEY | REPLACE_WITH_STRIPE_LIVE_SECRET_KEY |
| STRIPE_WEBHOOK_SECRET | REPLACE_WITH_STRIPE_WEBHOOK_SIGNING_SECRET |
| STRIPE_MAILBOX_MONTHLY_PRICE_ID | REPLACE_WITH_LIVE_MAILBOX_MONTHLY_PRICE_ID |
| STRIPE_MAILBOX_ANNUAL_PRICE_ID | REPLACE_WITH_LIVE_MAILBOX_ANNUAL_PRICE_ID |
| STRIPE_AI_MONTHLY_PRICE_ID | REPLACE_WITH_LIVE_AI_MONTHLY_PRICE_ID |
| STRIPE_AI_ANNUAL_PRICE_ID | REPLACE_WITH_LIVE_AI_ANNUAL_PRICE_ID |
| STRIPE_CHECKOUT_ENABLED | false |
| STRIPE_ENFORCE_SUBSCRIPTIONS | false |
| GSW_MAIL_PUBLIC_URL | https://mail.guidedstepswellness.com |

Stripe products and intended prices: GSW Mail ($2.50 monthly per mailbox / $15 yearly upfront per mailbox), GSW Hosted AI ($25 monthly per AI mailbox / $125 yearly upfront per AI mailbox). Create prices as USD-per-unit, recurring monthly/annually. No extra MCP cost. Core includes your own provider via MCP, paid directly to that provider; AI-hosted agentic features are optional.

## Production API routes

- GET /admin/billing?organizationId=UUID: billing state, legacy flag and active provisioned mailbox count.
- POST /admin/billing/checkout: admin-only, protected by checkout kill switch, returns Stripe Checkout URL.
- POST /admin/billing/portal: admin-only, protected by checkout kill switch, returns Stripe Customer Portal URL.
- POST /webhooks/stripe: verifies Stripe-Signature on the raw JSON body before parsing, reconciles current subscription state by customer ID, stores processed event IDs and ignores duplicates.

When STRIPE_ENFORCE_SUBSCRIPTIONS=true, new mailbox creation uses an advisory-locked transactional license check; existing mailboxes are never removed by the entitlement guard. Keep it false until all subscription state and legacy rules are proven and operators approve enforcement.

The only billing UI is /control-center#billing. Legacy-free workspaces are exempt from paid checkout; all billing endpoint access requires workspace owner/admin membership. No customer mailbox data is deleted on payment failure or subscription cancellation.

Configure the Stripe webhook destination as https://api.guidedstepswellness.com/webhooks/stripe with checkout.session.completed, customer.subscription.created/updated/deleted, invoice.paid and invoice.payment_failed. Put the destination's signing secret only in Railway.

## Remaining before charging customers

1. Confirm sales tax / VAT / GST policy and Stripe Tax configuration; do not invent the Stripe tax code.
2. Create products and four prices on the connected Stripe live account after tax policy is set, inspect existing catalog and avoid duplicates.
3. Replace Railway placeholders with the matching live Stripe key, webhook signing secret and Price IDs.
4. Verify Stripe Customer Portal behavior and a signed webhook delivery.
5. Add production-ready per-mailbox AI assignment, quantity changes, proration behavior and server-side entitlement enforcement. Preserve legacy free-for-life exemptions and rate limits.
6. Test webhook ordering and failure retries, checkout, renewal, cancellation, recovery, and all prices in controlled testing.
7. Enable STRIPE_CHECKOUT_ENABLED=true only after complete validation and explicit go-live approval. Enable STRIPE_ENFORCE_SUBSCRIPTIONS=true separately only after existing paid and legacy entitlements are reconciled.

## Storage and marketing

As of this update the included core email allowance is **5 GB per mailbox** ($2.50 monthly or $15 yearly upfront per mailbox). The forward-only 0046 migration raises existing email_accounts.quota_bytes values below 5 GB to this minimum, keeps larger custom allowances, and sets the database default. New mailbox creation and quota edits also enforce the minimum. The separate R2 file-storage quota is not a shared pooled mail+file allowance and should be described separately; verify Stalwart's physical mailbox quota enforcement before final billing launch. The live Stripe Tax decision is deferred; do not enable automatic tax collection. Avoid claiming unreleased booking links, third-party conferencing, Bible Study App live rooms or social livestreaming as already included.
