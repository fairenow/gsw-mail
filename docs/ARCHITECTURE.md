# Guided Steps Mail — Architecture

## 1. Principles

1. **Guided Steps Wellness owns its email infrastructure.** Not a Gmail clone.
2. **Rent delivery, own everything else.** Outbound starts behind a trusted SMTP relay;
   accounts, mailboxes, messages, sender identities, domains, business logic, UX, and
   data remain GSW-owned. Self-hosted outbound MTA is only a future option after the
   organization is prepared to manage IP reputation.
3. **Mail infrastructure is isolated from product logic.** The mail server must stay
   reliable even if AI, Convex, the website, a worker, or a third-party integration is
   down. Nothing in the critical mail path depends on product components.
4. **The API is the abstraction boundary.** Guided Steps products talk to the
   GSW Mail API. The engine behind it can be replaced without rewriting products.
5. **AI sits above mail, never inside the delivery path.** AI failure must never prevent
   delivery of normal email.

## 2. Domains

```text
guidedstepswellness.com        main website
mail.guidedstepswellness.com   mail application / user-facing interface
mx1.guidedstepswellness.com    primary mail server
api.mail.guidedstepswellness.com  mail application API
```

Future: `mx2.guidedstepswellness.com` (secondary MX). Kubernetes of the mail server
must not assume serverless; the engine needs persistent disk, a static/public IP,
the mail ports, uptime, and (eventually) reverse DNS.

## 3. System diagram

```text
                     GUIDED STEPS MAIL

                 guidedstepswellness.com
                          │
                          ▼
                      DNS / MX
                          │
                          ▼
                 Mail Infrastructure
                │
                 ┌────────┴─────────┐
                 │                  │
           Inbound SMTP        Outbound SMTP
                 │                  │
                 ▼                  ▼
           Mail Processing       SMTP Relay
                 │                  │
                 ▼                  ▼
            Mail Storage         Internet
                 │
                 ▼
            GSW Mail API
                 │
                 ▼
       Guided Steps Applications
```

## 4. Security boundary

```text
Public Internet
     │
     ▼
Mail Protocol Layer      (Stalwart: SMTP/IMAP/JMAP)
     │
     ▼
Mail Core                (Stalwart storage, routing, DKIM, spam)
     │
     ▼
Internal API             (GSW Mail API — this repo)
     │
     ▼
GSW Applications
```

The mail server is critical infrastructure and is **not** exposed directly to every
application. Only the internal API reaches it via JMAP. Administration endpoints
require elevated authorization.

Authentication: the web app signs in with Stalwart's OAuth authorization server
via PKCE (public client `gsw-mail-web`, no secret). The browser never talks to the
authorization server directly: the token exchange runs server-side through the
Better Auth's `/api/auth/*` routes, so `mail.guidedstepswellness.com` never needs
Stalwart CORS. The API verifies bearer access tokens through a short-lived,
expiry-bounded cache backed by Stalwart's `/auth/introspect`, authenticated as the
trusted Stalwart service account (`STALWART_MAIL_USERNAME`/`STALWART_MAIL_PASSWORD`).
It then resolves the canonical `sub` to a `users` row keyed by
`(identityProvider, identitySubject)`. Existing users take the lookup path;
JIT provisioning runs only when the identity is not present. Normal mailbox
operations reuse a bounded request-token JMAP engine cache, whose client retains
the JMAP session and mailbox metadata caches. The service credential is not used
to read the caller's mailbox. Background recovery jobs may use the explicitly
named service engine and require matching Stalwart delegation.
Authorization is role-based: org memberships (owner/admin/member) gate admin
operations; mail-account memberships (owner/delegate/read_only) gate mail
actions via read/send/manage permissions. `/health` and `/api/auth/*` are
public; `/mail/*` and `/admin/*` require an authenticated user. No infra
credentials are ever sent to the browser; dev-only fallbacks are disabled in
production.

## 5. Responsibilities

### Mail engine (Stalwart)
- SMTP, IMAP, JMAP
- Mail storage and routing
- Standard mailbox roles map from JMAP roles; custom or unrecognized folders remain unclassified and never fall back to Archive
- DKIM/DMARC/SPF validation and signing
- Spam processing
- Protocol authentication

### Guided Steps product layer (this repo)
- User experience, organizations, accounts, permissions
- Managed mailbox recovery orchestration: GSW issues hashed recovery codes and sends them to the verified workspace owner; Better Auth remains the resulting credential store
- Mail workflows (compose, reply, forward, archive, trash)
- Outbound queue and delivery-event ownership
- Search indexing at the product layer
- AI / automation / analytics / administration
- User settings and sanitized rich-text signatures
- Contacts product view, GSW relationship intelligence, engagement history, and CSV import history

### Database (Postgres)
- Product-level metadata only (organizations, domains, accounts, aliases,
  workspace setup progress and authorization memberships,
  outbound queue + recipients + attachment refs, delivery events,
  inbound-message index).
- Better Auth user, session, account, and verification records are Neon-owned
  control-plane data. They are separate from mailbox accounts and memberships.
- The mail server's complete internal state is **not** duplicated in Postgres.
- Stalwart is authoritative for standard contact identity and address-book membership
  through JMAP Contacts/JSContact. Neon stores the link plus GSW enrichment: tags,
  notes, outreach metadata, engagement counts, custom fields, and CSV import history.
  Legacy Neon identity columns remain as migration cache data until all records are
  linked; linked reads come from Stalwart. Sent-recipient contact growth is best-effort
  product metadata after Sent persistence and never blocks delivery.

### Object storage (future)
- Large attachments, exports, backups.

### Workers (future)
- Outbound queue, AI processing, indexing, notifications, bounce processing,
  scheduled jobs, maintenance.

## 6. Outbound flow

A send is never synchronous. The request creates an outbound row, saves a copy to
Sent in the engine, and returns 202 with an undo window:

When no custom HTML body is supplied, the API renders the configured server-side
mail template (`gsw_default` by default) into an email-safe HTML wrapper and keeps
the plain-text body as the fallback. The registry also contains the opt-in
`bible_reader` ministry template, but regular mail continues to use `gsw_default`.
The selected template key is persisted with the outbound queue row for recovery
and delivery observability.

```text
POST /mail/send  (authorized: read/send + rate + suppression checks)
       │
       ▼
Reserve outbound row as "preparing"
  (atomic ON CONFLICT (accountId, clientRequestId) DO NOTHING;
   stores the stable RFC Message-ID)
       │
       ▼
Save Sent copy via engine (Message-ID passthrough)
       │
       ▼
Finalize: "queued", nextAttemptAt = undoUntil (SEND_DELAY_SECONDS)
       │
       ▼
202 { sendId, messageId, threadId, status: queued, undoUntil }
```

Then the worker:

```text
Claim due/sending-stuck jobs  (single txn, FOR UPDATE SKIP LOCKED)
       │
       ▼
Relay (Resend / SES / Postmark / Mailgun)  → Message-ID/In-Reply-To/References headers
       │
       ▼
accepted → "accepted" (+ deliveryId)     permanent reject → "failed"
transient → re-queue with backoff 30/60/120/240s
```

Transport vs delivery:

```text
transport:  preparing → queued → sending → accepted → failed / cancelled
delivery:   pending → delivered | deferred | bounced | complained | partial_failure
```

`delivery_status` is derived from recipient-level events (`outbound_recipients`).
Hard bounces and complaints also insert organization-scoped suppressions that future
sends reject (409). A worker reconciles stuck `preparing` rows against the engine
(`findMessageByRfcMessageId`) instead of double-persisting Sent copies.

Delivery events are retained. Never send application mail synchronously.

## 7. Inbound flow (MVP)

```text
Internet
   │
   ▼
guidedstepswellness.com MX
   │
   ▼
Stalwart inbound SMTP
   │
   ▼
Mailbox (RocksDB → Stalwart storage)
   │
   ▼
GSW Mail API (JMAP read)
   │
   ▼
Web / product applications
```

Incoming messages must support: plain text, HTML, attachments, multipart MIME,
reply headers, thread identifiers, sender/recipient metadata, CC, BCC where
available, and message timestamps.

## 8. Events

Mail activity produces structured events (Phase 8+.9 ready — not yet all wired):

```text
mail.received           mail.sent            mail.delivered
mail.bounced            mail.failed          mail.opened
mail.replied            mail.spam_detected   mail.account.created
```

Other Guided Steps products consume these. Email is shared infrastructure for the
broader ecosystem (community, bible, library).

## 9. Data ownership

Defined/owned by GSW:

```text
Message bodies   Attachments   Headers   Mailbox state
Thread metadata  Contacts      Search indexes   Delivery events
```

Storage must support backup and restoration. Attachments may move to object
storage rather than the primary database.

## 10. Failure isolation

The critical mail path (Stalwart inbound → storage → JMAP read; queue → relay outbound)
must not share runtime state with product components. If the API is down, Stalwart
continues to receive and store mail; mail only becomes visible again when the API
returns. If AI is down, mail does not notice.

## September 11 implementation handoff

Protected route scopes install authentication before their handlers. Admin operations require explicit organizationId: query parameters for admin GET and suppression/alias DELETE; body fields for suppression POST, account POST/PATCH and alias POST. Missing identifiers return 400; absent or insufficient organization membership returns 403. Account delegation remains governed by account-owner manage permission.

Stalwart access remains inside MailEngine. Product UUIDs resolve to email addresses, which must match visible JMAP session account names. Sent persistence precedes queue finalization; the worker fetches attachment blobs from the engine and retries missing blobs instead of sending incomplete mail. Outbound delivery uses Resend; signed webhook events accept svix-id and data.email_id. Production configuration rejects demo/null backends and placeholder credentials.

Verification commands: `npm run typecheck`, `npm test --workspace apps/api`, `npm run test:integration --workspace apps/api`, `npm run test:acceptance --workspace apps/api`, and builds in both apps. Integration and acceptance reset only gsw_mail_test. The deployment bundle, acceptance steps, backups and monitoring are documented in [DEPLOYMENT.md](infra/DEPLOYMENT.md). Docker image execution, real Stalwart interoperability, external delivery and restore drills remain target-host release gates.


### Post-auth account resolution

Better Auth sessions resolve through the existing product user ID, including migrated mailbox identities. Existing workspace roles remain unchanged. Missing owned-mailbox and workspace memberships are reconciled idempotently without touching Stalwart. Credential recovery updates membership identity only for the recovering product user. GET `/api/account/context` validates active mailbox/workspace linkage and credential readiness before returning a destination. The web auth gate keeps product pages unmounted until session and context resolution finish, uses the branded state-driven loader, and offers retry/sign-out on failure. Product API 401 responses stop the application behind the recovery screen rather than signing out automatically. Resolution requests time out after 15 seconds; success animation adds 450ms and respects reduced motion.

The exact `/mail` page rewrite must precede the `/mail/:path*` API proxy in Vercel. `/mail` and `/sign-in` serve the web entry point; nested mail resources continue to reach Railway. Deployment checks must verify the `/mail` HTML response as well as API health.
