# Backup and restore

Minimum requirement: **primary storage → automated backup → separate location**, and a
restore procedure that is actually exercised. A backup that has never been restored is
not a verified backup.

## What to back up
| Asset | Source | Notes |
|-------|--------|-------|
| Mail state (stores/blobs/FTS/queue) | Docker volume `stalwart-data` (`/var/lib/stalwart`) | The critical asset |
| Mail config | Docker volume `stalwart-etc` (`/etc/stalwart`) | Includes DKIM keys when stored there |
| Product metadata | Postgres `gsw_mail` DB | organizations, domains, accounts, aliases, outbound queue, delivery events, message index |
| Secrets / env | `.env` files | Never to an unprotected location |

DKIM private keys and any encryption keys must be included (or re-provable).
Account configuration is restored with Stalwart's own store.

## Pattern (pg_dump + rclone/restic to separate location)
```bash
# Postgres product metadata
docker compose -f infra/docker-compose.yml exec -T postgres \
  pg_dump -U gsw_mail -d gsw_mail -Fc > backup/gsw_mail-$(date +%F).dump

# Stalwart data (snapshot the volume; stop container for a consistent copy)
docker compose -f infra/docker-compose.yml stop stalwart
tar czf backup/stalwart-data-$(date +%F).tar.gz \
  -C /var/lib/docker/volumes .../stalwart-data/_data
docker compose -f infra/docker-compose.yml start stalwart
```
Push the `backup/` folder to a separate storage location and a second site
(restic/rclone/S3-compatible object storage).

## Restore drill (schedule quarterly)
1. Restore `stalwart-data` + `stalwart-etc` volumes.
2. Restore Postgres dump via `pg_restore`.
3. Boot compose, confirm accounts/domains/mailboxes and a sample message are readable.
4. Record the drill date in `docs/infra/BACKUP.md` (keep a last-verified section).

## This is a stub
Automation is intentionally not implemented in Phase 0. Add a scheduled job
(host cron or a CI workflow) before any real mail volume exists.

---
Last verified restore: **not yet performed**