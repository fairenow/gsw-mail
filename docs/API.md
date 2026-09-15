# Guided Steps Mail API

Base path: `/mail`. Admin: `/admin`. Better Auth owns user-facing signup,
verification, password, magic-link, and cookie sessions at `/api/auth/*`.

Managed mailbox password recovery is handled by GSW at
`/api/account/request-password-reset` and
`/api/account/complete-password-reset`. GSW sends the six-digit code to the
active workspace owner's verified recovery email, including for migrated
mailboxes that do not yet have a Better Auth credential.
Stalwart is infrastructure only; the browser never redirects to its login page.
Development only: `X-GSW-User-Id` / `DEV_USER_ID`.

Authorization: org memberships (owner/admin/member) gate admin operations;
mail-account memberships (owner/delegate/read_only) gate mail actions:

| Role | read | send | manage |
|------|------|------|--------|
| owner | ✓ | ✓ | ✓ |
| delegate | ✓ | ✓ | |
| read_only | ✓ | | |

Schema validation: Zod. Errors are `{ "error": message }` with 4xx/5xx; invalid body
returns 400 with a Zod `issues` list.

Product routes use the same authenticated user but are intentionally separate from
the mail engine: settings, signatures, contacts, and import history are Neon/Postgres
metadata and never Stalwart mailbox state.

## Workspace Setup

Setup is resumable and persisted against the workspace. The control-plane identity
can configure the workspace and domain without receiving mailbox content access.
`email_accounts` is the current additive mailbox resource. Each row has an explicit
`workspace_id`, and the database enforces that it matches the workspace owning its domain.

| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/setup` | current workspace, domain, mailbox, and setup step |
| PATCH | `/api/setup/workspace` | workspace owner/admin; `{name}` |
| POST | `/api/setup/domain` | workspace owner/admin; `{domain}` |

## Accounts

| Method | Path | Notes |
|--------|------|-------|
| GET | `/mail/accounts` | accounts the caller belongs to (with `role` + `permissions`) |
| GET | `/mail/accounts/:id` | one account |
| GET | `/mail/accounts/:id/mailboxes` | mailboxes for an account (via engine) |
| POST | `/mail/accounts` | org admin (owner/admin); `{domainId, localPart, displayName?, quotaBytes?, ownerUserId?}` |
| PATCH | `/mail/accounts/:id` | org admin; `{status?, displayName?, quotaBytes?}` |
| POST | `/mail/accounts/:id/delegates` | account owner; `{userId, role?: delegate\|read_only}` |
| DELETE | `/mail/accounts/:id/delegates/:userId` | account owner; owner memberships are non-removable here |

Account JSON: `id, address, displayName, domain, status (pending|active|disabled),
quotaBytes, usedBytes`. List responses add `role` and `permissions`.

## Aliases

| Method | Path | Notes |
|--------|------|-------|
| GET | `/mail/aliases` | aliases targeting accounts the caller belongs to |
| POST | `/mail/aliases` | org admin; `{domainId, source, targetAccountId}` |
| DELETE | `/mail/aliases/:id` | org admin (owner/admin) |

## Messages

| Method | Path | Notes |
|--------|------|-------|
| GET | `/mail/mailboxes/stats?accountId` | standard mailbox total/unread counts from mailbox metadata |
| GET | `/mail/messages?accountId&mailbox=Inbox&limit&offset&threadId` | paginated list; `limit` is capped at 100 |
| GET | `/mail/messages/:id?accountId` | full message |
| POST | `/mail/messages/:id/read` | `{accountId, seen}` |
| POST | `/mail/messages/:id/flag` | `{accountId, flagged}` |
| POST | `/mail/messages/:id/move` | `{accountId, mailbox}` |
| POST | `/mail/messages/:id/archive` | `{accountId}` |
| POST | `/mail/messages/:id/trash` | `{accountId}` |
| POST | `/mail/messages/empty-trash` | `{accountId}`; permanently deletes all Trash messages |

The product `inbound_messages` table is an **index**, not the source of truth. A
failed index sync logs a warning but does not fail the mail action.

## Threads

| Method | Path | Notes |
|--------|------|-------|
| GET | `/mail/threads/:threadId?accountId` | messages in a thread |

## Send + drafts

| Method | Path | Notes |
|--------|------|-------|
| POST | `/mail/send` | `{accountId, to[], cc?, bcc?, subject?, textBody?, htmlBody?, templateKey?, replyTo?, inReplyTo?, references?, mode?, clientRequestId?}` → **202** `{sendId, messageId, threadId, status: "queued", undoUntil}` |
| POST | `/mail/drafts` | save draft → 201 `{engineId}` |
| PATCH | `/mail/drafts/:id` | update the draft with the same draft body fields → `{engineId}`; Stalwart replaces the immutable message body and retires the previous draft |
| POST | `/mail/drafts/:id/send` | `{accountId, mode?, templateKey?, clientRequestId?}` → **202**, same response as `/mail/send` |

Requires the `send` permission on the account. Recipients are checked against the
organization's suppression list (409 if suppressed) and `MAX_RECIPIENTS` /
`SEND_PER_MINUTE` / `SEND_PER_HOUR` limits (429). Sends route through the saga:
reserve → save Sent (stable RFC `Message-ID`) → queue, and can be cancelled during
the undo window — never synchronous. Optional `attachments` carries durable
attachment metadata (filename/type/size/disposition/contentId) into
`outbound_attachments`; canonical bytes live in Stalwart, so the transport relay
resolves binaries there before submission.

## Sends (undo / status / retry)

| Method | Path | Notes |
|--------|------|-------|
| GET | `/mail/sends/:id` | full send status (transport + delivery + recipients + timestamps) |
| POST | `/mail/sends/:id/cancel` | cancels while `preparing`/`queued`; moves the Sent copy back to Drafts via the engine |
| POST | `/mail/sends/:id/retry` | `{accountId}`; re-queues a `failed` send (no duplicate Sent copy) |

## Search

| Method | Path | Notes |
|--------|------|-------|
| GET | `/mail/search?q&accountId&mailbox?` | `from:john@example.com`, subject, body terms; NL search comes with the AI layer |

## Admin

| Method | Path | Notes |
|--------|------|-------|
| GET | `/admin/health` | DB + engine + relay status |
| GET | `/admin/stats` | queue (transport + delivery), spam blocked today, messages today |
| GET | `/admin/outbound` | recent outbound jobs (transport + delivery) |
| GET | `/admin/audit` | recent audit events, org-scoped (`?organizationId&limit&offset`) |
| GET | `/admin/suppressions` | organization suppression list (`?organizationId&limit&offset`) |
| POST | `/admin/suppressions` | manually suppress `{email, reason (hard_bounce|complaint|manual), organizationId?}` |
| DELETE | `/admin/suppressions/:id` | remove a suppression (un-suppress) |

Admin routes require an org `owner`/`admin` membership (no shared admin token); an
optional `organizationId` scopes the operation and must be an organization the
caller administers. Suppression mutations are recorded in the audit log.

## Outbound states

```text
transport:  preparing → queued → sending → accepted → failed / cancelled
delivery:   pending → delivered | deferred | bounced | complained | partial_failure
```

GSW internal retry re-queues an `accepted`-before-claim failure with backoff
(30/60/120/240s); provider deferral is a delivery-level observation only.
`delivery_status` is derived from per-recipient events in `outbound_recipients`;
hard bounces and complaints insert organization-scoped `delivery_suppressions`
that block future sends. Delivery events append to `outbound_delivery_events`
(provider-event-idempotent).

## Settings and contacts

| Method | Path | Notes |
|--------|------|-------|
| GET | `/product/settings` | user settings and sanitized signature |
| PATCH | `/product/settings` | merge general, compose, or contacts preferences |
| PUT | `/product/signature` | sanitized HTML plus generated plaintext; new/reply/forward flags and quote placement |
| GET | `/product/contacts?q=&limit=100&offset=0` | paginated contact search; returns `contacts`, `total`, `limit`, and `offset`, ranked by exact match, engagement, and recency |
| GET | `/product/contacts/:id` | contact detail |
| POST | `/product/contacts` | create normalized contact with emails, phones, tags, and custom fields |
| PATCH | `/product/contacts/:id` | update contact and normalized child records |
| GET | `/product/contact-imports` | import history counts, including duplicates and failures |
| GET | `/product/contact-imports/:id/rows` | raw and failed import rows |
| POST | `/product/contact-imports` | mapped CSV rows with `skip`, `merge`, or `overwrite` duplicate behavior; returns row, created, updated, skipped, duplicate, and failed counts |
| GET | `/product/calendars?accountId=` | calendars available through the selected mailbox account's Stalwart JMAP session |
| GET | `/product/calendar-events?accountId=&after=&before=` | read-only calendar events in the requested ISO date range |
| POST | `/product/calendar-events` | create an event in a Stalwart calendar; supports `meetingLink`, attendee emails, and confirmed `sendSchedulingMessages` |
| PATCH | `/product/calendar-events/:id` | update an event in Stalwart; scheduling notifications are opt-in per request |
| DELETE | `/product/calendar-events/:id?accountId=` | delete an event from Stalwart |

Successful outbound sends asynchronously record each recipient in the caller's
contact scope, creating a `sent_mail` contact or incrementing engagement on the
matching normalized email. Contact tables, signatures, settings, and import batches
are product metadata; Stalwart remains the canonical message engine.

## Engine switching

`MAIL_ENGINE=demo|stalwart`. `demo` serves plausible data so the API runs without
Stalwart or Postgres (some routes still need Postgres for metadata). `stalwart` is the
production JMAP adapter with fetch-injected protocol tests; live Stalwart acceptance remains required.

## September 11 implementation handoff

Protected route scopes install authentication before their handlers. Admin operations require explicit organizationId: query parameters for admin GET and suppression/alias DELETE; body fields for suppression POST, account POST/PATCH and alias POST. Missing identifiers return 400; absent or insufficient organization membership returns 403. Account delegation remains governed by account-owner manage permission.

Stalwart access remains inside MailEngine. Product UUIDs resolve to email addresses, which must match visible JMAP session account names. Sent persistence precedes queue finalization; the worker fetches attachment blobs from the engine and retries missing blobs instead of sending incomplete mail. Outbound delivery uses Resend; signed webhook events accept svix-id and data.email_id. Production configuration rejects demo/null backends and placeholder credentials.

Verification commands: `npm run typecheck`, `npm test --workspace apps/api`, `npm run test:integration --workspace apps/api`, `npm run test:acceptance --workspace apps/api`, and builds in both apps. Integration and acceptance reset only gsw_mail_test. The deployment bundle, acceptance steps, backups and monitoring are documented in [DEPLOYMENT.md](infra/DEPLOYMENT.md). Docker image execution, real Stalwart interoperability, external delivery and restore drills remain target-host release gates.
