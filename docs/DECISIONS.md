# Decisions

Status key: **adopted** · **proposed** · **revisit**

| # | Decision | Status | Rationale |
|---|----------|--------|-----------|
| 1 | **Mail engine: Stalwart Mail Server** (`stalwartlabs/stalwart`, v0.16) | adopted | Full stack SMTP/IMAP/JMAP/mail storage/DKIM/spam/ManageSieve in one Rust binary; active project; Docker image; admin UI for bootstrap. Avoids writing SMTP/IMAP/deliverability from scratch. |
| 2 | **Product layer: TypeScript** | adopted | Matches the existing Guided Steps Wellness ecosystem (Convex, Vite/React, Expo). |
| 3 | **Product DB: PostgreSQL 16 + Drizzle** | adopted | Product metadata only. Drizzle gives typed schema + generated SQL migrations. |
| 4 | **API framework: Fastify** | adopted | TypeScript-first, schema validation, plugin model, fast. |
| 5 | **Engine abstraction (MailEngine interface)** | adopted | API must remain stable while the engine behind it can be swapped (Stalwart now, another engine later). This is the Phase 3 abstraction boundary. |
| 6 | **Outbound via SMTP relay first; never synchronous sends** | adopted | Own the queue + delivery events; rent delivery until managing outbound IP reputation is operationally worthwhile. MVP uses Resend; SES/Postmark/Mailgun are drop-in relays via config. |
| 7 | **Stalwart access via JMAP** (adapter + session status check in repo) | adopted | JMAP is native to Stalwart v0.16 (its management API and admin UI are JMAP objects over `/jmap`), modern, JSON-based for the product layer. IMAP remains the external-client protocol, not the product path. |
| 8 | **Do not duplicate Stalwart's internal state in Postgres** | adopted | Postgres holds product metadata + an inbound-message **index** for product search/threading, not full mail state. |
| 9 | **Product messages are an index, not source of truth** | adopted | Full messages live in Stalwart. The product `messages` table caches metadata for search/threads/security metadata. |
| 10 | **AI above mail, never in the delivery path** | adopted | AI processing consumes mail events; it can never block receive/send. |
| 11 | **Multi-domain data model from day one** | adopted | `domains` is modeled separately so the platform can later host churches/ministries on their own domains without a rewrite. |
| 12 | **Identity = Better Auth sessions** | superseded | Better Auth sessions are the canonical user-facing identity. The original Stalwart OIDC bearer-token design remains historical only; Stalwart is mail infrastructure, not the login provider. |
| 13 | **Stalwart bootstrap: datastore config, no bootstrap template** | adopted | v0.16 dropped the first-boot `config.toml` bridge: it writes a small datastore-oriented `config.json` and all management/configuration lives in JMAP objects. Bind empty named volumes (`stalwart-etc`, `stalwart-data`) and drive via the admin UI/API. The legacy `config.toml.example` is kept only as a pre-v0.16 reference. |
| 14 | **Outbound sends are idempotent** | adopted | `clientRequestId` keys the outbound queue so a retried request never double-sends. Delivery webhooks record relay events idempotently (`providerEventId`). |
| 15 | **Production fails closed on configuration** | adopted | In production the API refuses to start on placeholder/default secrets, a missing webhook secret, or the `null` relay. Details in `config.ts` validation. |
| 16 | **Gmail-like send saga: reserve → save Sent → finalize** | adopted | `INSERT ... ON CONFLICT (accountId, clientRequestId) DO NOTHING` as `preparing` (atomic serialization point, stores the RFC Message-ID), engine `saveSent` inside the request, then mark `queued`. A crash mid-request is reconciled by a worker. Never send synchronously. |
| 17 | **Stable RFC `Message-ID` generated before any external op** | adopted | The send's `Message-ID`, `In-Reply-To`, and `References` are generated/preserved at the API and flow through saveSent and the relay headers, so view → reply/reference and provider matching keys stay consistent. |
| 18 | **Undo window via claim-time backoff** | adopted | `nextAttemptAt = undoUntil` (`SEND_DELAY_SECONDS`, default 5) and the worker claims only due jobs, so a `202` client can cancel before claim. `cancel` moves the Sent copy back to Drafts via the engine; `retry` re-queues only `failed` sends (no duplicate Sent copy). |
| 19 | **`transport_status` vs `delivery_status` split** | adopted | Transport (preparing/queued/sending/accepted/failed/cancelled) is owned by the queue/worker; delivery (pending/delivered/deferred/bounced/complained/partial_failure) is derived from recipient-level events. GSW internal retry re-queues; provider deferral is a delivery-level observation. |
| 20 | **Recipient-level delivery state + suppression list** | adopted | `outbound_recipients` tracks each envelope recipient; message `delivery_status` is derived. Hard bounces and complaints insert organization-scoped `delivery_suppressions`, which future sends check (rejected 409). |
| 21 | **Audit log (no message bodies)** | adopted | `audit_events` records account/alias/admin mutations with actor, org, resource, IP/UA. Never stores message content. |
| 22 | **Outbound attachment model before attachment sending** | adopted | `outbound_attachments` persists durable metadata + Stalwart attachment refs (binary bytes stay in Stalwart/object storage). Relay resolves binaries per §37; Postgres never stores the bytes. |
| 23 | **Delegation + alias lifecycle are audited management ops** | adopted | `POST/DELETE /mail/accounts/:id/delegates` (account owner, `manage`) and `DELETE /mail/aliases/:id` (org owner/admin) close the §10 audit gaps: `account.delegate_added/removed`, `alias.deleted`. Owner memberships are non-removable via the delegate endpoint. |
| 24 | **Server-side OAuth token exchange** | superseded | Replaced by Better Auth branded application sessions. The browser no longer redirects to Stalwart for normal login. |
| 25 | **Stalwart token validation** | superseded | Better Auth is the OIDC issuer; Stalwart validates short-lived asymmetric bearer tokens against Better Auth discovery/JWKS. No Stalwart account credential is used to inspect or read user mail. |
| 26 | **Mailbox ownership = memberships; login identity = Stalwart username** | adopted | `/mail/accounts` returns the accounts the resolved Neon user has `mailAccountMemberships` rows for — never "the account you logged in as" by itself. Production authentication idempotently provisions the matching Neon user, account, owner membership, and organization membership; the bootstrap seed only creates the organization/domain and an explicitly configured initial owner. |
| 27 | **Normal JMAP access is request-scoped** | superseded | Replaced by Better Auth-issued user-scoped OAuth access tokens. There is no Stalwart service credential, introspection account, or impersonation path for mail reads. |
| 28 | **Merged Contacts product with split ownership** | adopted | Stalwart is authoritative for standard contact identity and address-book membership through JMAP Contacts/JSContact. Neon stores `stalwartContactId` plus GSW-specific tags, notes, outreach metadata, engagement counts, custom fields, and CSV import history. |
| 29 | **Rich text is sanitized at both edges** | adopted | The browser sanitizes pasted/editor content for usability, while the API sanitizes signature, draft, and send HTML before persistence or engine submission. Plaintext is stored/generated alongside HTML for fallback delivery. |
| 30 | **Short-lived authentication and JMAP caches** | adopted | Existing identities skip provisioning; token introspection, active-user resolution, Stalwart engines, JMAP sessions, mailbox metadata, and product account-address resolution use bounded TTL caches. First-login JIT provisioning remains available without making normal mailbox traffic pay its transaction cost. |
| 31 | **Control-plane workspace setup is separate from mailbox access** | adopted | Workspace setup progress is persisted against the organization. Workspace administration can configure the workspace and domains, while mailbox content access remains governed by explicit mail-account memberships. |
| 32 | **Better Auth owns user-facing authentication** | adopted | GSW signup, email verification, password, one-time email access, and sessions are branded application flows backed by Neon. Stalwart no longer serves normal user login pages or OAuth redirects; it remains the mail resource engine behind the API. |
| 33 | **Additive tenancy normalization before table renames** | adopted | `organizations` remains the workspace parent and `email_accounts` remains the mailbox resource during migration. Explicit workspace and Better Auth foreign keys are added first; existing identifiers such as `ramon-prod` remain compatible until reads and writes are fully migrated. |
| 34 | **GSW owns managed mailbox recovery** | adopted | Mailbox recovery issues and sends a hashed six-digit token to the verified workspace owner recovery email, then creates or updates the Better Auth credential. Better Auth self-service recovery remains for control accounts; mailbox recovery never depends on a pre-existing Better Auth mailbox identity. |

## Open questions

- Attachment object storage provider (S3-compatible vs GSW-owned object storage).
- Whether outbound should ever route through Stalwart's own relay queue instead of
  the GSW queue (current: GSW queue is authoritative for MVP).
- Spam/ham learning and FBL-style complaint backchannels beyond the recorded
  `complained` delivery event.

## September 11 implementation handoff

Protected route scopes install authentication before their handlers. Admin operations require explicit organizationId: query parameters for admin GET and suppression/alias DELETE; body fields for suppression POST, account POST/PATCH and alias POST. Missing identifiers return 400; absent or insufficient organization membership returns 403. Account delegation remains governed by account-owner manage permission.

Stalwart access remains inside MailEngine. Product UUIDs resolve to email addresses, which must match visible JMAP session account names. Sent persistence precedes queue finalization; the worker fetches attachment blobs from the engine and retries missing blobs instead of sending incomplete mail. Outbound delivery uses Resend; signed webhook events accept svix-id and data.email_id. Production configuration rejects demo/null backends and placeholder credentials.

Verification commands: `npm run typecheck`, `npm test --workspace apps/api`, `npm run test:integration --workspace apps/api`, `npm run test:acceptance --workspace apps/api`, and builds in both apps. Integration and acceptance reset only gsw_mail_test. The deployment bundle, acceptance steps, backups and monitoring are documented in [DEPLOYMENT.md](infra/DEPLOYMENT.md). Docker image execution, real Stalwart interoperability, external delivery and restore drills remain target-host release gates.


### Post-auth account resolution

Better Auth sessions resolve through the existing product user ID, including migrated mailbox identities. Existing workspace roles remain unchanged. Missing owned-mailbox and workspace memberships are reconciled idempotently without touching Stalwart. Credential recovery updates membership identity only for the recovering product user. GET `/api/account/context` validates active mailbox/workspace linkage and credential readiness before returning a destination. The web auth gate keeps product pages unmounted until session and context resolution finish, uses the branded state-driven loader, and offers retry/sign-out on failure. Product API 401 responses stop the application behind the recovery screen rather than signing out automatically. Resolution requests time out after 15 seconds; success animation adds 450ms and respects reduced motion.

The exact `/mail` page rewrite must precede the `/mail/:path*` API proxy in Vercel. `/mail` and `/sign-in` serve the web entry point; nested mail resources continue to reach Railway. Deployment checks must verify the `/mail` HTML response as well as API health.

Account resolution now displays the supplied `/loading-animation-1.gif` while session/context requests are pending. Status copy remains driven by real progress. Success and reduced-motion preferences use the static logo; navigation does not wait for the GIF to finish.

### Better Auth OIDC mailbox access

Better Auth is the permanent OIDC issuer and signs asymmetric, short-lived access
tokens for the `stalwart` audience. Neon membership and mailbox readiness are
checked before the authorization-code exchange. The token email claim is the
complete mailbox address and Stalwart is configured with `claimUsername=email`;
there is no username domain, impersonation, shared credential, or global mail
service identity. Existing Stalwart principals and mail state are preserved.
