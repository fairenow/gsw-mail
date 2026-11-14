# GSW Mail — Stripe billing v1
Updated: November 14, 2026.

## Approved commercial rules
- **First mailbox free for life:** Every customer workspace includes one lifetime-free Core mailbox (5 GB). Each additional mailbox is $15/year paid upfront, or $2.50/month when monthly billing is selected. No charge for aliases that do not create a new mailbox.
- **Free domain administration:** administrators do not incur a mailbox charge solely by administering a workspace; adding and managing domains is free.
- **Optional GSW-hosted AI:** $25 per AI-enabled mailbox monthly or $125 annually. AI entitlement may be assigned to individual mailboxes by a workspace administrator. Core mailbox remains separately billed.
- **MCP included:** use MCP with any compatible external AI provider without purchasing GSW AI. Third-party provider charges remain the customer's responsibility.
- **API included with reasonable operational limits:** initial soft budget (not yet enforced) 10,000 API requests, 5,000 MCP calls, 500 outbound emails per mailbox per month; 5 GB email storage per mailbox. Limits must be tuned against measured cost; do not treat as an unlimited sending commitment.
- **Web-only billing:** settings is the only place to check out, manage billing methods, and purchase licenses. Mobile clients consume server-side entitlements but never initiate checkout.
- **Two owner-operator exceptions:** The currently owned Guided Steps Wellness and Faire Rideshare workspaces associated with `ramon.williams.jr@gmail.com` and `24hrautollc@gmail.com` have unlimited Core mailboxes at no charge through explicit `billing_mailbox_exemptions` entries. No other existing workspace receives unlimited Core mailboxes based on its legacy flag. Exceptions do not waive anti-spam or safety controls.

## Implementation boundaries
Migration 0048 adds the dedicated `billing_mailbox_exemptions` table and grants exactly two operator-owned workspaces an unlimited Core-mailbox entitlement. All other workspaces receive one included free mailbox, regardless of signup date. Historical `legacy_free_for_life` flags and the original 0045 cutoff triggers remain as audit history; the active billing and provisioning decisions no longer treat those flags as unlimited mailboxes. This is additive and does not delete mailboxes or charge customers. Stripe Checkout quantities represent **paid** mailboxes (total desired minus one free) and AI seats remain separately payable, including on the first free mailbox. Billing enforcement still uses the existing explicit feature switch.

Remaining before launch:
1. Configure Stripe restricted secret key, webhook signing secret, four recurring Price IDs (mailbox monthly/yearly, AI monthly/yearly), and allowed web return origin.
2. Server-side Checkout Session creation using authenticated workspace owners/admins only. Quantities must be computed and checked on the server against provisioned mailboxes, and AI <= mailboxes.
3. Verified Stripe webhook handler with durable idempotency; subscription reconciliation must not trust the browser redirect and must handle failed payment/canceled/past_due and invoice events.
4. Settings billing UI for owner/admin: current subscription, mailbox counts, AI license assignments, invoices, Checkout and Customer Portal.
5. Centralized entitlement checks for mailbox provisioning, AI chat/scheduled work and API requests, applied to both web and mobile/MCP paths; test quota races and graceful overdue/downgrade behavior.
6. Audit existing account eligibility and monitor invoice vs. entitlement divergence before enabling enforcement. Operator-exempt workspaces bypass paid mailbox entitlements, **not security/abuse controls**.

## Policy notes
Do not charge per domain, domain administrator, alias, OAuth connection or MCP connection.
Unpaid subscription must never trigger automatic deletion of existing mail/files.
Do not interpret a successful checkout redirect as payment confirmation.
The initial usage budgets are policy placeholders only; enforcement is deliberately disabled until metering is verified.

## Homepage free mailbox invitation
- All new customer workspaces qualify for **one included mailbox free for life**, regardless of registration date.
- A dismissible homepage modal explains the one-free-mailbox offer and the price of each additional mailbox.
- Do not advertise unlimited free mailboxes for an account solely because it registered before November 21, 2026.
- Billing status distinguishes the one included seat, purchased extra seats, and explicit operator exemptions.

## Railway automatic migrations

The production Neon database has an incomplete Drizzle migration journal (14 recorded migrations as of November 12, 2026), while historical schema changes were applied through direct/ensure scripts. **Do not run an unconditional `drizzle-kit migrate` in production**, as it could replay older migrations. Instead, Railway runs one compiled entry point: `node apps/api/dist/db/runDeploymentMigrations.js`. This entry point invokes the existing MCP approval/send-policy migration first, followed by the forward-only billing migration manifest.

The forward-only runner declares approved new migrations in an ordered manifest, with a durable `public.gsw_deployment_migrations` ledger, SHA-256 checksums, an advisory lock, and a transactional rollback on failure. First approved migration is `0045_billing_foundation.sql`. For subsequent schema changes, add a new numbered SQL migration and append it to `DEPLOYMENT_MIGRATIONS` in `runDeploymentMigrations.ts`. Do not edit a migration after it has been applied.

Railway pre-deploy must run **one command**: `node apps/api/dist/db/runDeploymentMigrations.js`. Railway service settings are staged but must not be applied to the currently deployed `main` revision because the runner is only in the feature branch. Once the branch is merged and the build contains the compiled runner, apply the pre-deploy configuration and redeploy. The migration runner must be present in the built API bundle. Take a production snapshot/backup prior to first migration, and validate the legacy count afterwards. Stripe keys and subscriptions are not required for the migration.

## November 14, 2026 policy update — implementation
- `0048_mailbox_free_allowance.sql` creates an audit-friendly operator exemption table; it does not change past migration checksums.
- `/admin/billing`, Checkout, Stripe webhooks, and mailbox creation use explicit exemptions rather than historical `legacy_free_for_life` flags.
- The first mailbox is free, including on new workspaces created after November 21, 2026.
- Subscription enforcement remains off until the full launch checklist passes. Never enable checkout/enforcement merely because the migration succeeds.
- No automatic charge, mailbox removal, subscription mutation, or existing data migration occurs from this policy change.
