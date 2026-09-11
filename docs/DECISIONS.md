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
| 7 | **Stalwart access via JMAP** (adapter stub in repo) | proposed | JMAP is native to Stalwart, modern, and JSON-based for the product layer. IMAP fallback possible. |
| 8 | **Do not duplicate Stalwart's internal state in Postgres** | adopted | Postgres holds product metadata + an inbound-message **index** for product search/threading, not full mail state. |
| 9 | **Product messages are an index, not source of truth** | adopted | Full messages live in Stalwart. The product `messages` table caches metadata for search/threads/security metadata. |
| 10 | **AI above mail, never in the delivery path** | adopted | AI processing consumes mail events; it can never block receive/send. |
| 11 | **Multi-domain data model from day one** | adopted | `domains` is modeled separately so the platform can later host churches/ministries on their own domains without a rewrite. |
| 12 | **Identity integration deferred to Phase 9** | adopted | MVP uses the GSW identity placeholder in the API; protocol credentials (IMAP/JMAP) remain separate from application identity. |
| 13 | **Stalwart bootstrap: let it generate config, keep Hosted an example** | adopted | First boot writes `config.toml`; we bind empty named volumes. A Postgres-backend config template is provided as a production reference. |

## Open questions

- Bounce/abuse handling: first pass retains delivery events; feedback-loop and
  complaint handling come with Phase 4 hardening.
- Attachment object storage provider (S3-compatible vs GSW-owned object storage).
- Whether outbound should ever route through Stalwart's own relay queue instead of
  the GSW queue (current: GSW queue is authoritative for MVP).