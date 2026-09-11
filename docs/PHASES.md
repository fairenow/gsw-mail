# Phase status

Tracking map across the Guided Steps Wellness Mail Platform spec.

## Phase 0 — Infrastructure proof of concept
**Goal:** independently receive and store email for guidedstepswellness.com.

- [x] Mail infrastructure repository scaffold (`infra/`, `apps/`, `docs/`)
- [x] Persistent storage, env/secrets, TLS, logging, backup conventions defined
- [x] Docker Compose for Stalwart + Postgres
- [ ] Provision host (persistent disk, static IP, mail ports, uptime)
- [ ] First run: add domain in Stalwart UI, create test account `test@guidedstepswellness.com`
- [ ] **Success:** external message lands in a GSW-controlled mailbox

## Phase 1 — Domain and receiving infrastructure
- [ ] DNS records: MX, SPF, DKIM, DMARC, A/AAAA (see `docs/DNS.md`)
- [ ] Optional: MTA-STS, TLS-RPT, autodiscovery
- [ ] Working inbound SMTP (plain/HTML/MIME/attachments/thread headers)
- [ ] Verify DKIM/DMARC/SPF pass on a received message

## Phase 2 — Account and mailbox system
- [x] `organizations`, `domains`, `users`, `emailAccounts`, `aliases` in schema
- [x] Mailboxes: Inbox, Sent, Drafts, Spam, Trash, Archive
- [x] Account lifecycle (create/disable) + quota
- [x] Aliases (`hello@...` → `ramon@...`)
- [x] Multi-user auth + authorization model: `users` keyed by
      `(identityProvider, identitySubject)` from a signed JWT (issuer/audience/JWKS),
      org memberships (owner/admin/member), mail-account memberships
      (owner/delegate/read_only) with permissions read/send/manage. No infra secrets
      are exposed to the browser; dev-only fallbacks are disabled in production.

## Phase 3 — Guided Steps Mail API
- [x] Routes scaffold: accounts, aliases, messages, threads, send, drafts, search, admin
- [x] Engine abstraction (swappable backend)
- [ ] Stalwart JMAP adapter implementation (session status check done)
- [ ] Thread assembly
- [ ] Attachments API

## Phase 4 — Outbound sending
- [x] Outbound queue model + states + delivery events
- [x] Relay interface (Resend adapter, demo adapter)
- [x] Worker skeleton
- [x] Idempotent sends (`clientRequestId`) + atomic claim (no duplicate delivery)
- [x] Delivery webhook with signature verification: `delivered`/`bounced`/`complained` persisted idempotently
- [x] Gmail-like send saga: reserve (`preparing`) → save Sent → finalize (`queued`),
      stable RFC Message-ID generated before any external op, 202 + undo window
      (`SEND_DELAY_SECONDS`), cancel/retry endpoints, `preparing` reconciliation
- [x] `transport_status` / `delivery_status` split + recipient-level delivery state
      (`outbound_recipients`), delivery suppression list, audit log
- [ ] Real relay credentials + retry/backoff tuning
- [ ] **Done:** message from Gmail arrives → Ramon reads → replies → Gmail user receives it

## Phase 5 — Basic mail application
- [x] Web shell scaffold (folders + message list pane)
- [ ] Inbox, Compose, Reply, Reply all, Forward
- [ ] Sent, Drafts, Spam, Trash
- [ ] Archive, mark read/unread, delete
- [ ] Attachment download
- [ ] Basic search field

## Phase 6 — Search
- [ ] Indexed search (sender, recipient, subject, body, date, attachments, domain, thread)
- [ ] Query syntax (`from:john@example.com`); natural-language search later (AI)

## Phase 7 — Spam and security hardening
- [ ] SPF/DKIM/DMARC validation metadata on inbound
- [ ] Spam scoring, attachment restrictions, malware scanning
- [x] API-level rate limiting
- [ ] Failed-login protection, account lockouts, IP abuse detection, throttle

## Phase 8 — AI intelligence layer
- [ ] Mail events → AI processing (classification: needs response, waiting, referral, …)
- [ ] AI never blocks delivery
- [ ] Referral/contact extraction example

## Phase 9 — Product integration
- [x] Identity integration with Guided Steps Wellness accounts (signed JWT + JWKS,
      users keyed by `(identityProvider, identitySubject)`, org + account memberships)
- [ ] Events consumed by other GSW products

## Phase 10 — Organization / custom-domain hosting
- [ ] Multi-org domains, verification flows (mx/spf/dkim/dmarc status)

## MVP gate
Complete when Ramon can use `ramon@guidedstepswellness.com` without Gmail as the
mailbox: receive → read → reply → send → receive replies → view sent → attachments →
basic search → persistent history → administer without Google Workspace.
Outbound may still ride an SMTP relay.