# First-party engagement analytics

Capture starts globally in the Vite React root and writes batches to `POST /product/analytics/events` in the existing Neon Postgres database. Run the new SQL migration using the existing migration workflow before deploying API code.

## Tracked
- Route landing, SPA navigation and page exit
- Clicks by semantic element or an explicit safe `data-analytics="feature_name"` key
- Scroll depth thresholds (25/50/75/90/100 percent)
- Active/hidden tabs, duration, browser LCP and layout shift
- Anonymous visitor and session IDs (not linked to mailbox users)

**Privacy:** No email bodies, message text, search queries, URLs with query strings, arbitrary element labels, raw mouse positions or text inputs. `data-analytics-ignore` suppresses capture for private subtrees. Respect DNT/GPC. Retention: schedule a daily `DELETE FROM engagement_events WHERE occurred_at < NOW() - INTERVAL '90 days'` (and VACUUM strategy as appropriate) on Neon; no automatic purge job is deployed here.

**Operations:** API rate limits apply. Configure `ANALYTICS_ADMIN_USER_ID` with the Better Auth user ID for owner-only summary access. The summary API is intended as a building block for a future admin dashboard; it is not exposed to normal users. Migration should be checked against production schema before applying.

## Deployment and migration on Railway

The API Dockerfile contains a dedicated `migrate` build stage with `CMD ["npm", "run", "db:migrate"]`; the normal runtime stage starts Node directly and **does not automatically run Drizzle migrations**. Before deploying the analytics API, run a Railway migration job using the `migrate` target and the intended Neon `DATABASE_URL`, or run `npm run db:migrate --workspace apps/api` in a Railway environment that provides that database URL. Do not run it locally against production unless intentionally using production credentials. Verify the new `engagement_events` table and indexes exist before routing web traffic to the updated API.

The web workspace uses pinned `web-vitals@5.1.0` with a synchronized npm lockfile. The package sends metrics only to the existing same-origin analytics endpoint. The browser routes inside `/mail` are represented as virtual screen paths such as `/mail/chat` and `/mail/scheduled`.

## Release checks

Run `npm ci`, `npm run typecheck`, `npm run build --workspace apps/web`, `npm run test --workspace apps/api`, and smoke-test the `/product/analytics/events` endpoint before merging. Verify permissions for the admin summary route, DNT/GPC behavior, and new task creation/editing/pause/history on narrow and wide screens. A deployment must include retention scheduling separately.
