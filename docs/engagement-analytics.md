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
