# GSW Mail — Stripe billing v1
Updated: November 12, 2026.

## Approved commercial rules
- **One simple mailbox subscription:** $2.50 per mailbox monthly, or $15 per mailbox annually (paid upfront).
- **Free domain administration:** administrators do not incur a mailbox charge solely by administering a workspace; adding and managing domains is free.
- **Optional GSW-hosted AI:** $25 per AI-enabled mailbox monthly or $125 annually. AI entitlement may be assigned to individual mailboxes by a workspace administrator. Core mailbox remains separately billed.
- **MCP included:** use MCP with any compatible external AI provider without purchasing GSW AI. Third-party provider charges remain the customer's responsibility.
- **API included with reasonable operational limits:** initial soft budget (not yet enforced) 10,000 API requests, 5,000 MCP calls, 500 outbound emails per mailbox per month; 1 GB per mailbox. Limits must be tuned against measured cost; do not treat as an unlimited sending commitment.
- **Web-only billing:** settings is the only place to check out, manage billing methods, and purchase licenses. Mobile clients consume server-side entitlements but never initiate checkout.
- **No discounts/tiers for v1.** Accounts registered before November 21, 2026 at 00:00 America/Detroit (2026-11-21 05:00 UTC) receive a permanent `legacy_free_for_life=true` flag. Free-for-life grants do not override safety/anti-spam controls.

## Implementation boundaries
Phase 1 is an *additive foundation*. Applying the migration does not enable charging or revoke access. The migration determines eligibility from account registration timestamps, **not migration execution time**. Users registered before the cutoff are also tagged when their product identity is created or linked later. New workspaces created after the cutoff default to nonlegacy; registration-based user grants are retained. Run a production backup and verify counts before/after migration.

Remaining before launch:
1. Configure Stripe restricted secret key, webhook signing secret, four recurring Price IDs (mailbox monthly/yearly, AI monthly/yearly), and allowed web return origin.
2. Server-side Checkout Session creation using authenticated workspace owners/admins only. Quantities must be computed and checked on the server against provisioned mailboxes, and AI <= mailboxes.
3. Verified Stripe webhook handler with durable idempotency; subscription reconciliation must not trust the browser redirect and must handle failed payment/canceled/past_due and invoice events.
4. Settings billing UI for owner/admin: current subscription, mailbox counts, AI license assignments, invoices, Checkout and Customer Portal.
5. Centralized entitlement checks for mailbox provisioning, AI chat/scheduled work and API requests, applied to both web and mobile/MCP paths; test quota races and graceful overdue/downgrade behavior.
6. Audit existing account eligibility and monitor invoice vs. entitlement divergence before enabling enforcement. Legacy accounts bypass paid entitlements, **not security/abuse controls**.

## Policy notes
Do not charge per domain, domain administrator, alias, OAuth connection or MCP connection.
Unpaid subscription must never trigger automatic deletion of existing mail/files.
Do not interpret a successful checkout redirect as payment confirmation.
The initial usage budgets are policy placeholders only; enforcement is deliberately disabled until metering is verified.

## Homepage prelaunch invitation
- On the public homepage only, show a dismissible registration modal after **7 seconds** if the cutoff has not yet passed.
- Modal headline: "Your mail. Free for life." Link directly to /sign-up.
- Dismissal is remembered for the browser tab session; users can dismiss via close button, Escape, or the backdrop.
- Stop showing the campaign after midnight Eastern on November 21, 2026; the browser date controls presentation only and cannot issue entitlements.
- The free-for-life migration, signup eligibility, and billing decisions use the server/database cutoff at **2026-11-21 05:00:00+00**.
- Existing and eligible future users can be given true in the database via the automated migration/trigger or a documented administrator-approved update. The flag is not editable by the user.

## Railway automatic migrations

The production Neon database has an incomplete Drizzle migration journal (14 recorded migrations as of November 12, 2026), while historical schema changes were applied through direct/ensure scripts. **Do not run an unconditional `drizzle-kit migrate` in production**, as it could replay older migrations. Instead, Railway runs the existing MCP approval migration followed by `node apps/api/dist/db/runDeploymentMigrations.js` when that file exists.

The forward-only runner declares approved new migrations in an ordered manifest, with a durable `public.gsw_deployment_migrations` ledger, SHA-256 checksums, an advisory lock, and a transactional rollback on failure. First approved migration is `0045_billing_foundation.sql`. For subsequent schema changes, add a new numbered SQL migration and append it to `DEPLOYMENT_MIGRATIONS` in `runDeploymentMigrations.ts`. Do not edit a migration after it has been applied.

Railway pre-deploy must use both commands in order:
1. `node apps/api/dist/db/applyMcpApprovalMigration.js`
2. `sh -c 'if [ -f apps/api/dist/db/runDeploymentMigrations.js ]; then node apps/api/dist/db/runDeploymentMigrations.js; else echo "No forward migration runner in this build"; fi'`

The existence guard allows the configuration to be deployed safely while the feature branch remains unmerged. It does **not** ignore migration execution failures. Take a production snapshot/backup prior to first migration, and validate the legacy count afterwards. Stripe keys and subscriptions are not required for the migration.
