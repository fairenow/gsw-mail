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
- [x] Persisted control-plane workspace setup state and resumable setup endpoints
- [x] Better Auth branded signup, verification, password, magic-link, and session boundary
- [x] GSW-owned managed mailbox recovery for pending and ready mailbox identities
- [x] Mailboxes: Inbox, Sent, Drafts, Spam, Trash, Archive
- [x] Account lifecycle (create/disable) + quota
- [x] Aliases (`hello@...` → `ramon@...`)
- [x] Multi-user auth + authorization model: `users` keyed by
      `(identityProvider, identitySubject)` from Better Auth sessions;
      Stalwart is no longer a user-facing identity provider,
      org memberships (owner/admin/member), mail-account memberships
      (owner/delegate/read_only) with permissions read/send/manage. No infra secrets
      are exposed to the browser; dev-only fallbacks are disabled in production.

## Phase 3 — Guided Steps Mail API
- [x] Routes scaffold: accounts, aliases, messages, threads, send, drafts, search, admin
- [x] Engine abstraction (swappable backend)
- [x] Stalwart JMAP adapter implementation and protocol tests (live host acceptance pending)
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

## Settings and contacts foundation
- [x] `/settings` sections for General, Signature, Compose, Contacts, and future Templates
- [x] Sanitized rich-text signatures with HTML/plaintext storage and compose insertion
- [x] Rich compose body with safe pasted HTML and restrained formatting toolbar
- [x] Neon contacts with normalized emails/phones/tags, engagement counts, and custom fields
- [x] Sent-recipient automatic contact creation/update and compose autocomplete
- [x] CSV preview, mapping, duplicate merge/skip/overwrite, and import history
- [x] Merged Contacts ownership boundary: Stalwart standard identity, Neon GSW enrichment
- [x] Nullable Stalwart contact linkage and lazy idempotent migration for existing contacts
- [x] Request-scoped JMAP Contacts methods for address books and ContactCards
- [ ] Contact enrichment from inbound mail and attachment/image upload workflow

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

## September 11 implementation handoff

Protected route scopes install authentication before their handlers. Admin operations require explicit organizationId: query parameters for admin GET and suppression/alias DELETE; body fields for suppression POST, account POST/PATCH and alias POST. Missing identifiers return 400; absent or insufficient organization membership returns 403. Account delegation remains governed by account-owner manage permission.

Stalwart access remains inside MailEngine. Product UUIDs resolve to email addresses, which must match visible JMAP session account names. Sent persistence precedes queue finalization; the worker fetches attachment blobs from the engine and retries missing blobs instead of sending incomplete mail. Outbound delivery uses Resend; signed webhook events accept svix-id and data.email_id. Production configuration rejects demo/null backends and placeholder credentials.

Verification commands: `npm run typecheck`, `npm test --workspace apps/api`, `npm run test:integration --workspace apps/api`, `npm run test:acceptance --workspace apps/api`, and builds in both apps. Integration and acceptance reset only gsw_mail_test. The deployment bundle, acceptance steps, backups and monitoring are documented in [DEPLOYMENT.md](infra/DEPLOYMENT.md). Docker image execution, real Stalwart interoperability, external delivery and restore drills remain target-host release gates.


### Post-auth account resolution

Better Auth sessions resolve through the existing product user ID, including migrated mailbox identities. Existing workspace roles remain unchanged. Missing owned-mailbox and workspace memberships are reconciled idempotently without touching Stalwart. Credential recovery updates membership identity only for the recovering product user. GET `/api/account/context` validates active mailbox/workspace linkage and credential readiness before returning a destination. The web auth gate keeps product pages unmounted until session and context resolution finish, uses the branded state-driven loader, and offers retry/sign-out on failure. Product API 401 responses stop the application behind the recovery screen rather than signing out automatically. Resolution requests time out after 15 seconds; success animation adds 450ms and respects reduced motion.

Live acceptance remains required: start with a migrated mailbox in `pending`, send recovery through its workspace owner, redeem the OTP and create the password, sign in, and confirm context resolves to the original product user and mailbox. Verify `/mail/accounts` returns only authorized memberships and message requests succeed. Compare Stalwart mailbox IDs and message IDs before and after recovery. Also verify retry after a context failure, a product 401 stopping Mail without signing out, and reduced-motion rendering. Unit tests cover migrated identity resolution, repeated reconciliation, role preservation, and inactive-user rejection; they do not substitute for this live flow.

The exact `/mail` page rewrite must precede the `/mail/:path*` API proxy in Vercel. `/mail` and `/sign-in` serve the web entry point; nested mail resources continue to reach Railway. Deployment checks must verify the `/mail` HTML response as well as API health.

Account resolution now displays the supplied `/loading-animation-1.gif` while session/context requests are pending. Status copy remains driven by real progress. Success and reduced-motion preferences use the static logo; navigation does not wait for the GIF to finish.

Mailbox access is now staged behind Better Auth OAuth Provider interoperability. Ramon and Alyssa tokens must resolve to their existing Stalwart principals before any production authentication-directory change. No shared mailbox credential or impersonation path is permitted; provisioning credentials remain limited to Stalwart lifecycle management.

## Responsive mail UI fixes — September 2026

- [x] Constrain list rows and truncate sender, subject, and preview text.
- [x] Add fixed list footer with previous/next pages and mailbox totals.
- [x] Overlay folder navigation on phone/tablet list and reader views.
- [x] Expand phone/tablet search from an icon across the header.
- [x] Bound compose height and scroll long content; full-screen compose on phones.
