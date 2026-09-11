# Guided Steps Mail

Privately owned email infrastructure for Guided Steps Wellness.

This repository builds the mail platform described in the Guided Steps Wellness Mail
Platform spec: ownership of mailboxes, user accounts, email addresses, incoming mail,
message storage, domain configuration, administrative controls, and internal APIs —
while renting only the delivery infrastructure that is smarter to rent (an SMTP relay
for initial outbound).

## Architecture at a glance

```text
guidedstepswellness.com
        │  DNS / MX
        ▼
Mail infrastructure (Stalwart Mail Server)
        │
        ├── Inbound SMTP → Mail storage
        └── Outbound (GSW-controlled queue → SMTP relay → Internet)
        │
        ▼
GSW Mail API   (the abstraction boundary — this repo)
        │
        ▼
Guided Steps applications
```

The guiding rule:

> Separate **mail infrastructure** from **Guided Steps product logic**. The mail server
> must stay reliable even if the website, a worker, a UI feature, or a third-party
> integration is down. Only the API lives in front of it.

## Repository layout

```text
gsw-mail/
├── docs/                  # Architecture, decisions, DNS, phases, ops guides
│   └── infra/             # Stalwart config reference, backup guide
├── infra/                 # Docker Compose (Stalwart + Postgres), env, scripts
├── apps/
│   ├── api/               # GSW Mail API (TypeScript, Fastify, Postgres/Drizzle)
│   └── web/               # Basic mail application shell (Vite + React)
```

## Technology

| Layer     | Choice                              | Notes                                             |
|-----------|-------------------------------------|---------------------------------------------------|
| Mail engine | Stalwart Mail Server (`stalwartlabs/stalwart:v0.16`) | SMTP/IMAP/JMAP, storage, DKIM, spam processing. IBM not written from scratch. |
| Product DB | PostgreSQL 16                       | Product metadata only. Mail internal state stays in Stalwart. |
| API        | TypeScript + Fastify                | The abstraction boundary. Swappable engine behind it. |
| ORM        | Drizzle                             | Typed schema + SQL migrations.                    |
| Outbound relay | Resend (placeholder)             | Infrastructure only; the queue and delivery events are GSW-owned. |
| Web app    | Vite + React                        | Phase 5 basic mail interface.                     |

## Quick start (local development)

```bash
# 1. Infrastructure: mail server + product database
cp infra/.env.example infra/.env
docker compose -f infra/docker-compose.yml up -d
#   → Stalwart writes its bootstrap config to /etc/stalwart on first boot and
#     prints the admin account + password via `docker logs stalwart`.
#     Log in at http://localhost:8080 to create the domain and the first account.

# 2. API
cd apps/api
cp .env.example .env
npm install
npm run db:generate   # generate SQL migrations from schema
npm run db:migrate    # apply to Postgres
npm run dev           # http://localhost:4000

# 3. Web shell
cd apps/web
npm install
npm run dev           # http://localhost:3000 (proxies /mail → :4000)
```

The API ships with a `MAIL_ENGINE=demo` mode that returns plausible data so the
skeleton can be exercised end to end before real Stalwart credentials exist.

## Phase status

Current phase: **Phase 0/1 foundation scaffold** (see `docs/PHASES.md`).

- [ ] Phase 0 — infrastructure proof of concept
- [ ] Phase 1 — domain and receiving infrastructure
- [ ] Phase 2 — account and mailbox system
- [ ] Phase 3 — Guided Steps Mail API
- [ ] Phase 4 — outbound sending + queue
- [ ] Phase 5 — basic mail application
- [ ] Phase 6 — search
- [ ] Phase 7 — spam and security hardening
- [ ] Phase 8 — AI intelligence layer
- [ ] Phase 9 — product integration
- [ ] Phase 10 — organization / custom-domain hosting

## MVP definition

Complete when `ramon@guidedstepswellness.com` works without Gmail: receive, read,
reply, send, receive replies, view sent, handle attachments, search, persist history,
administer without Google Workspace. Outbound may still ride an SMTP relay.

## Key engineering rule

Mail delivery and storage are infrastructure-critical. The API, AI, Convex, the
website, and third-party integrations must be able to be down without stopping mail.