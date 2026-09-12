# Monitoring runbook

Probe `/health` every minute for process liveness. It does not prove the database or mail engine works. With an administrator JWT, probe `/admin/health?organizationId=<uuid>` and inspect `ok`, `db` and `mailEngine.ok`; this route returns JSON even when a dependency is unhealthy. Alert after three consecutive failures.

Poll `/admin/stats?organizationId=<uuid>` for queued, sending and failed operations. Alert on queue growth for ten minutes, any sustained failures, and sending jobs older than the five-minute reclaim window. Inspect `/admin/outbound` for failureCode and nextAttemptAt; the route returns the most recent 50 operations, so use a read-only database query for full backlog age.

Monitor disk space on both mail volumes and Postgres (warning 80%, critical 90%), certificate expiry under 14 days, host memory, container restarts, webhook signature failures and backup age over 26 hours. Rotate container logs and restrict access because logs can contain mail metadata. Configure equivalent rotation for Stalwart and Postgres on the host.

Run an external inbound/outbound synthetic mail check daily with dedicated mailboxes and alert on missing receipt within five minutes. Monitor backup transfer success separately from backup creation. Restore quarterly into an isolated environment and record the result in BACKUP.md.

Response: check dependency health, disk and certificates first; inspect relay rejection details before retries. Do not clear queue rows to hide failures. Avoid logging JWTs, webhook secrets or full message bodies. Monitoring thresholds and alert routing must be configured in the deployment's monitoring system; this repository does not install a monitoring service.
