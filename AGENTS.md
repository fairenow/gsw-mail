# Agent guide

## Commands
- API dev: `cd apps/api && npm run dev` (tsx watch, http://localhost:4000)
- API typecheck: `cd apps/api && npm run typecheck`
- API tests: `cd apps/api && npm test` (node:test + tsx; unit tests only, no DB required)
- API migrations: `cd apps/api && npm run db:generate && npm run db:migrate`
- Web dev: `cd apps/web && npm run dev` (http://localhost:3000)
- Infra: `docker compose -f infra/docker-compose.yml up -d` (Stalwart + Postgres)

## Conventions
- TypeScript everywhere. No code comments; self-documenting identifiers.
- The `MailEngine` interface in `apps/api/src/engine/types.ts` is the load-bearing
  abstraction boundary. Product code must not call Stalwart directly.
- Outbound sends are never synchronous: always through the outbound queue.
- Product DB = metadata/index only. Full mail state lives in Stalwart.
- Keep the docs in sync when behavior changes (ARCHITECTURE.md, PHASES.md, DECISIONS.md).
- Always run `npm run db:migrate` after generating a new migration; report clearly if the configured database is unavailable.

## Status
Phase 0/1 foundation scaffold. Verify with `npm run typecheck` in both apps before
finishing work. Docker is not available on this workstation; compose is validated
statically.
