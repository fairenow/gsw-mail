# Guided Steps Mail API

Base path: `/mail`. Admin: `/admin`. Auth: `Authorization: Bearer <token>` or, in
development only, `X-GSW-User-Id` / `DEV_USER_ID`. Identity resolution is a
placeholder until it integrates with the Guided Steps Wellness identity system.

Schema validation: Zod. Errors are `{ "error": message }` with 4xx/5xx; invalid body
returns 400 with a Zod `issues` list.

## Accounts

| Method | Path | Notes |
|--------|------|-------|
| GET | `/mail/accounts` | accounts owned by the caller |
| GET | `/mail/accounts/:id` | one account |
| GET | `/mail/accounts/:id/mailboxes` | mailboxes for an account (via engine) |
| POST | `/mail/accounts` | admin; create account + default mailboxes |
| PATCH | `/mail/accounts/:id` | admin; status / displayName / quota |

Account JSON: `id, address, displayName, domain, status (pending|active|disabled),
quotaBytes, usedBytes`.

## Aliases

| Method | Path | Notes |
|--------|------|-------|
| GET | `/mail/aliases` | list aliases |
| POST | `/mail/aliases` | admin; `{domainId, source, targetAccountId}` |

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
| POST | `/mail/send` | `{accountId, to[], cc?, bcc?, subject?, textBody?, htmlBody?, replyTo?, inReplyTo?, references?}` → 202 with `{jobId, status: "queued"}` |
| POST | `/mail/drafts` | save draft → 201 `{engineId}` |
| POST | `/mail/drafts/:id/send` | `{accountId}` → 202 `{jobId, status: "queued"}` |

Sends save to Sent via the engine, then enqueue — never send synchronously.

## Search

| Method | Path | Notes |
|--------|------|-------|
| GET | `/mail/search?q&accountId&mailbox?` | `from:john@example.com`, subject, body terms; NL search comes with the AI layer |

## Admin

| Method | Path | Notes |
|--------|------|-------|
| GET | `/admin/health` | DB + engine + relay status |
| GET | `/admin/stats` | queue, spam blocked today, messages today |
| GET | `/admin/outbound` | recent outbound jobs |

## Outbound queue states

`draft → queued → sending → sent → delivered`, with `deferred` (retry with backoff),
`bounced`, `failed` terminal states. Delivery events are appended to
`outbound_delivery_events`.

## Engine switching

`MAIL_ENGINE=demo|stalwart`. `demo` serves plausible data so the API runs without
Stalwart or Postgres (some routes still need Postgres for metadata). `stalwart` is the
production JMAP adapter, stubbed until Phase 3 implementation.