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
| 12 | **Identity integration deferred to Phase 9** | adopted | MVP uses API tokens mapped to a user record; protocol credentials (IMAP/JMAP) remain separate from application identity. Production rejects header/dev identity fallbacks. |
| 13 | **Stalwart bootstrap: datastore config, no bootstrap template** | adopted | v0.16 dropped the first-boot `config.toml` bridge: it writes a small datastore-oriented `config.json` and all management/configuration lives in JMAP objects. Bind empty named volumes (`stalwart-etc`, `stalwart-data`) and drive via the admin UI/API. The legacy `config.toml.example` is kept only as a pre-v0.16 reference. |
| 14 | **Outbound sends are idempotent** | adopted | `clientRequestId` keys the outbound queue so a retried request never double-sends. Delivery webhooks record relay events idempotently (`providerEventId`). |
| 15 | **Production fails closed on configuration** | adopted | In production the API refuses to start on placeholder/default secrets, a missing webhook secret, or the `null` relay. Details in `config.ts` validation. |

## Open questions

- Attachment object storage provider (S3-compatible vs GSW-owned object storage).
- Whether outbound should ever route through Stalwart's own relay queue instead of
  the GSW queue (current: GSW queue is authoritative for MVP).
- Spam/ham learning and FBL-style complaint backchannels beyond the recorded
  `complained` delivery event.