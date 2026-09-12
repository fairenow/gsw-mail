# Backup and restore

Run `npx tsx scripts/backup.ts /absolute/backup/path` from the repository root on the Docker host. Schedule it daily in the host scheduler. The script stops API writes and Stalwart, dumps Postgres, archives both Stalwart volumes and restarts services in a finally block. The compose project name must remain `gsw-mail`. This maintenance window temporarily interrupts inbound mail; remote senders should retry.

Encrypt and transfer the completed directory to a separate host or object store with restricted credentials. Back up `infra/.env` and `infra/api.env` separately in a secrets vault. Retain daily sets for 30 days and monthly sets for a year, adjusting to the organization's retention requirements. Alert on failed runs, transfer failures and backups older than 26 hours. Do not archive a running RocksDB volume with an ordinary file copy.

## Restore drill

1. Use an isolated Docker host with the same Stalwart image. Keep external inbound, outbound and API access disabled.
2. Create the compose volumes and stop API/Stalwart. Restore each archive into its matching empty volume with a temporary container, preserving permissions (Stalwart UID 2000). Never extract over a live datastore.
3. Start Postgres and restore metadata: `docker compose --env-file infra/.env -f infra/docker-compose.yml exec -T postgres pg_restore -U gsw_mail -d gsw_mail --exit-on-error < /backup/metadata.dump`. Use a freshly created empty database and the configured username/database if different.
4. Restore environment secrets and start Stalwart. Verify accounts, keys, mailboxes and sample attachment hashes. Before starting the API, reconcile queued/sending operations against provider delivery records; restoring a queue can replay external side effects.
5. Start API and run two-user acceptance with a test relay. Record backup timestamp, restore duration, sampled message IDs and results. Only then approve production recovery.

Last verified restore: not performed; Docker unavailable on the development workstation. The script and procedure require a target-host restore drill before production cutover.
