# GSW Mail — Stripe billing v1
Updated: November 12, 2026.

## Approved commercial rules
- **One simple mailbox subscription:** $2.50 per mailbox monthly, or $15 per mailbox annually (paid upfront).
- **Free domain administration:** administrators do not incur a mailbox charge solely by administering a workspace; adding and managing domains is free.
- **Optional GSW-hosted AI:** $25 per AI-enabled mailbox monthly or $125 annually. AI entitlement may be assigned to individual mailboxes by a workspace administrator. Core mailbox remains separately billed.
- **MCP included:** use MCP with any compatible external AI provider without purchasing GSW AI. Third-party provider charges remain the customer's responsibility.
- **API included with reasonable operational limits:** initial soft budget (not yet enforced) 10,000 API requests, 5,000 MCP calls, 500 outbound emails per mailbox per month; 1 GB per mailbox. Limits must be tuned against measured cost; do not treat as an unlimited sending commitment.
- **Web-only billing:** settings is the only place to check out, manage billing methods, and purchase licenses. Mobile clients consume server-side entitlements but never initiate checkout.
- **No discounts/tiers for v1.** Existing legacy users/workspaces retain free-for-life access to existing functionality, with safety/anti-spam limits unchanged.

## Implementation boundaries
Phase 1 is an *additive foundation*. Applying the migration does not enable charging or revoke access. The migration snapshots existing users and workspaces in an atomic transaction; any user/workspace created after it completes defaults to nonlegacy. Run the migration before enabling signup-based billing, using production backup and counts before/after.

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
