# GSW Delivery and the unified mailbox API

Updated October 30, 2026. The [mailbox API service plan](GSW_MAIL_API_SERVICE_PLAN.md) is authoritative for the current API direction. This document records the delivery boundary underneath it.

## Product position

GSW Mail is the first customer of the shared delivery infrastructure. External applications should use one mailbox API, managed with server keys in the customer's GSW admin portal. That API must eventually expose every supported mailbox capability, including sending; delivery is one part of the API rather than a separately permissioned customer product.

The current API branch implements only the narrower email pilot. [Its reference](integrations/email-api-pilot.md) documents exact routes and restrictions. Full mailbox access is the approved direction and has not shipped simply because it is documented.

## Architecture decisions

- Keep Stalwart behind MailEngine and the existing relay. Shared GSW services own tenant/mailbox authorization, request tracking, idempotency, delivery status and capacity accounting.
- Use one full-mailbox grant for external keys. Do not require per-feature scopes, fixed recipient lists, separate developer OAuth registration or workflow-specific keys in the customer setup. The pilot's narrower controls are implementation gaps to replace.
- Keep admin control separate: the customer creates/revokes keys and manages service access in the admin portal. No mailbox API key may manage domains/DNS, provision mailbox accounts, change admin membership or create API credentials. Earlier suggestions for public domain-management routes are outside this mailbox API.
- A connection is workspace-owned, binds an explicit mailbox and can be managed by current authorized admins. The creator is recorded for audit; continued creator membership should not be the sole service authority.
- Never give external developers Stalwart admin credentials or JMAP superuser access. Implement durable authorized mailbox service access without substituting an admin identity for the mailbox.
- Continue to queue outbound sends. Persist acceptance atomically, deduplicate request retries, reconcile uncertain submissions and retain status evidence. Do not claim exactly-once delivery.
- Use the same shared sending core and existing consent, unsubscribe, suppression and sender validity behavior for mailbox operations. Broad API coverage does not bypass those product rules.

## Admin experience

Target **Admin → API**: select a mailbox, create a full-access server key, inspect key metadata, rotate/revoke keys, pause/resume the connection, review health/activity/usage and open linked documentation/examples. No granular capability builder is required.

The current **Control Center → Email Delivery** panel implements pilot connections, narrow scopes/recipient grants, key creation/revocation and pause/resume. The consolidated API information/documentation experience remains outstanding. Customer guide: [mailbox API](integrations/mailbox-api.md).

## Delivery readiness

Before production acceptance, verify sender/domain alignment, actual mailbox authorization and real delivery. Validate delivery events, suppression, duplicate retries, outage recovery and unknown-submission reconciliation. Apply the pilot migration before deploying the changed worker. The configured database was unavailable during implementation; isolated database tests passed, but no production migration or real send was established.

The target mailbox API should cover reading and organizing mail, drafts, replies, cc/bcc, templates/signatures, attachments, supported scheduling, contacts, calendars, files, campaigns and other available mailbox functions. Maintain a concrete parity inventory rather than assuming existing MCP exposure means HTTP coverage exists.

Signed customer webhooks, usage/activity/health screens, recovery tools, retention policies and pricing remain work. Future workflow/catalog features use these same mailbox services without another registration or permission tier. Optional OAuth or more granular APIs can be reconsidered later.

## Existing transport cutover safeguards

- Deploy with `OUTBOUND_RELAY=stalwart`; check actual submissions and inbox arrival before removing old relay dependencies.
- Preserve existing marketing consent, unsubscribe, suppression and sender-domain behavior when exposing campaign operations.
- Keep administrative notification identity separate from customer mailbox ownership and sender reputation.
