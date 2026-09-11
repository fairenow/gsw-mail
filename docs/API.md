# Guided Steps Mail API

Base path: `/mail`. Admin: `/admin`. Auth: `Authorization: Bearer <JWT>`. In
production the JWT is verified against the Identity Provider JWKS
(`JWT_ISSUER`/`JWKS_URL`/`JWT_AUDIENCE`) and resolved to a `users` row keyed by
`(identityProvider, identitySubject)`. Development only: `X-GSW-User-Id` /
`DEV_USER_ID`.

Authorization: org memberships (owner/admin/member) gate admin operations;
mail-account memberships (owner/delegate/read_only) gate mail actions:

| Role | read | send | manage |
|------|------|------|--------|
| owner | ✓ | ✓ | ✓ |
| delegate | ✓ | ✓ | |
| read_only | ✓ | | |

Schema validation: Zod. Errors are `{ "error": message }` with 4xx/5xx; invalid body
returns 400 with a Zod `issues` list.

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
| GET | `/mail/messages?accountId&mailbox=Inbox&limit&offset&threadId` | list |
| GET | `/mail/messages/:id?accountId` | full message |
| POST | `/mail/messages/:id/read` | `{accountId, seen}` |
| POST | `/mail/messages/:id/flag` | `{accountId, flagged}` |
| POST | `/mail/messages/:id/move` | `{accountId, mailbox}` |
| POST | `/mail/messages/:id/archive` | `{accountId}` |
| POST | `/mail/messages/:id/trash` | `{accountId}` |

The product `inbound_messages` table is an **index**, not the source of truth. A
failed index sync logs a warning but does not fail the mail action.

## Threads

| Method | Path | Notes |
|--------|------|-------|
| GET | `/mail/threads/:threadId?accountId` | messages in a thread |

## Send + drafts

| Method | Path | Notes |
|--------|------|-------|
| POST | `/mail/send` | `{accountId, to[], cc?, bcc?, subject?, textBody?, htmlBody?, replyTo?, inReplyTo?, references?, clientRequestId?}` → **202** `{sendId, messageId, threadId, status: "queued", undoUntil}` |
| POST | `/mail/drafts` | save draft → 201 `{engineId}` |
| POST | `/mail/drafts/:id/send` | `{accountId, clientRequestId?}` → **202**, same response as `/mail/send` |

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

## Engine switching

`MAIL_ENGINE=demo|stalwart`. `demo` serves plausible data so the API runs without
Stalwart or Postgres (some routes still need Postgres for metadata). `stalwart` is the
production JMAP adapter, stubbed until Phase 3 implementation.