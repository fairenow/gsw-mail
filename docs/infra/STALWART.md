# Stalwart Mail Server — operations reference

Image: `stalwartlabs/stalwart:v0.16` (pin minor series in production).

## Layout
| Path | Purpose |
|------|---------|
| `/etc/stalwart`  | configuration (bootstrap `config.toml`; runtime config may live in DB) |
| `/var/lib/stalwart` | data: stores, blobs, FTS indexes, queue (RocksDB default) |

Image runs unprivileged (UID 2000). If bind-mounting host dirs, `chown 2000:2000`.

## First boot
Container generates `config.toml`, boots, and prints the admin credentials:
```text
✅ Configuration file written to /etc/stalwart/config.toml
🔑 Your administrator account is 'admin' with password '…'
```
Admin UI: `http://localhost:8080` (http) and `https://localhost:443` (https, self-signed
by default). `docker logs stalwart` shows the initial password.

Env (`infra/.env`):
```text
STALWART_PUBLIC_URL=https://mx1.guidedstepswellness.com
STALWART_RECOVERY_ADMIN=admin:<password>   # bootstrap admin
TZ=America/Detroit
HOSTNAME=mx1.guidedstepswellness.com       # server hostname
```

## Post-boot configuration (admin UI)
1. Settings → Server → Network: confirm hostname.
2. Management → Directory → Domains: add `guidedstepswellness.com` — the UI prints the
   MX/SPF/DKIM/DMARC records to add (mirror `docs/DNS.md`).
3. Management → Directory → Accounts/Groups: create accounts + passwords. These are the
   JMAP/IMAP credentials the GSW Mail API uses to read/write mailboxes.

## Protocol/port map
| Port | Service |
|------|---------|
| 25   | SMTP inbound |
| 465  | SMTPS (submission, implicit TLS) |
| 587  | Submission (STARTTLS) |
| 143  | IMAP |
| 993  | IMAPS |
| 4190 | ManageSieve |
| 443  | Admin UI (https) / JMAP endpoint for API use |
| 8080 | Admin UI (http) |

Local dev may remap 443/8080 if another local service uses them.

## Storage backends
- Default: RocksDB (self-contained; fine for dev and small deployments).
- Production option: PostgreSQL backend — set every `storage.*` key to a `postgresql`
  cluster store. A Postgres-backed bootstrap `config.toml` template is provided at
  `docs/infra/config.toml.example`. After bootstrap, runtime config lives in Postgres
  (`s` table); use the admin UI for changes.

## Outbound
MVP outbound does **not** rely on Stalwart's queue. The GSW API owns the queue and
calls the configured SMTP relay (Resend/SES/Postmark/Mailgun). Stalwart can also be
configured as a relay client later if GSW's queue is replaced.

## Health
`curl -sfk https://localhost:443/healthz`

## Logs
`docker compose -f infra/docker-compose.yml logs -f stalwart`

## Backup
See `docs/infra/BACKUP.md`. Stalwart data (volume `stalwart-data`) is the mail state
to snapshot; config (volume `stalwart-etc`) is configuration; the Postgres volume
holds product metadata.