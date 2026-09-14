# Stalwart Mail Server — operations reference

Image: `stalwartlabs/stalwart:v0.16.18`.

## Layout
| Path | Purpose |
|------|---------|
| `/etc/stalwart`  | datastore-oriented `config.json` (small bootstrap file only) |
| `/var/lib/stalwart` | data: stores, blobs, FTS indexes, queue (RocksDB default) |

Image runs unprivileged (UID 2000). If bind-mounting host dirs, `chown 2000:2000`.

## v0.16 configuration model (important)

v0.16 removed the old `config.toml` bridge. On first boot the container writes a small
`config.json` that points at the datastore; **all** meaningful configuration and
management — servers, domains, accounts, aliases, quotas, TLS, spam rules — are JMAP
objects exposed over the JMAP API (`/jmap`). The admin UI and the `stalwart-cli` both
talk to that same JMAP surface.

Consequences for this repo:
- Do not hand-write a `config.toml`. `docs/infra/config.toml.example` is retained only
  as a pre-v0.16 reference and is **not** used by the v0.16 image.
- Management is done in the admin UI (loopback only) or via JMAP with the admin token —
  the same mechanism the GSW Mail API's JMAP adapter uses.

## First boot
Container bootstraps its datastore `config.json`, opens the configured listeners, and
prints the initial admin credentials to the logs:
```text
🔑 Your administrator account is 'admin' with password '…'
```
Admin UI on the datastore config: `https://localhost:443` (self-signed by default).
`STALWART_RECOVERY_ADMIN` must be set in `infra/.env`; compose fails closed if absent.

Env (`infra/.env`):
```text
STALWART_PUBLIC_URL=https://mx1.guidedstepswellness.com
STALWART_RECOVERY_ADMIN=admin:<password>   # bootstrap admin
TZ=America/Detroit
HOSTNAME=mx1.guidedstepswellness.com       # server hostname
```

## Post-boot configuration (admin UI / JMAP)
1. Settings → Server → Network: confirm hostname.
2. Management → Directory → Domains: add `guidedstepswellness.com` — the UI prints the
   MX/SPF/DKIM/DMARC records to add (mirror `docs/DNS.md`).
3. Management → Directory → Accounts/Groups: preserve existing accounts and principals.
   Provisioning credentials are for lifecycle management only and are never used for
   normal JMAP mail access.

## Better Auth OIDC directory

Configure a separate OIDC directory only after the interoperability spike succeeds:

```json
{
  "@type": "Oidc",
  "description": "GSW Better Auth",
  "issuerUrl": "https://mail.guidedstepswellness.com/api/auth",
  "requireAudience": "stalwart",
  "requireScopes": { "openid": true, "email": true },
  "claimUsername": "email",
  "claimName": "name"
}
```

Do not configure `usernameDomain`. Validate discovery, JWKS, Ramon, and Alyssa
JMAP sessions before switching the production authentication directory.

The directory must be the active `Authentication.directoryId`, not merely a
created directory object. For a rejected JMAP session, compare the safe token
metadata (`iss`, `aud`, `email`, `preferred_username`, `scope`, `exp`, `alg`,
and `kid`) with this directory and verify that the issuer discovery and JWKS
are reachable from the Stalwart host. Never log or paste the bearer token.

Register the confidential Better Auth OAuth client through the Better Auth admin
API with the callback URI in `BETTER_AUTH_STALWART_REDIRECT_URI`, scopes
`openid email`, PKCE enabled, and consent skipped only for this first-party
server client. Store its secret only in the API environment.

## Protocol/port map
| Port | Service | Bind |
|------|---------|------|
| 25   | SMTP inbound | public |
| 465  | SMTPS (submission, implicit TLS) | public |
| 587  | Submission (STARTTLS) | public |
| 143  | IMAP | public |
| 993  | IMAPS | public |
| 4190 | ManageSieve | public |
| 443  | HTTPS: admin UI + JMAP endpoint for API use | public |
| 8080 | Admin UI (http) | loopback only (`127.0.0.1:8080:8080`) |

Postgres in the same compose file binds to loopback only (`127.0.0.1:5432`); nothing
else on a private network, no raw cross-publish of the DB.

## Storage backends
- Default: RocksDB (self-contained; fine for dev and small deployments).
- Production option: PostgreSQL backend — set every `storage.*` key to a `postgresql`
  cluster store. Because runtime config now lives in JMAP, the old `config.toml`
  Postgres template no longer applies; configure via the datastore directories in the
  admin UI / JMAP management objects.

## Outbound
MVP outbound does **not** rely on Stalwart's queue. The GSW API owns the queue and
calls the implemented Resend HTTP relay. Stalwart can also be
configured as a relay client later if GSW's queue is replaced.

## Health
The API engine status discovers the authenticated JMAP session at `/.well-known/jmap`. Use `/admin/health?organizationId=<uuid>` with an administrator JWT for dependency monitoring. No curl-based healthcheck is assumed inside the Stalwart image.

## Logs
`docker compose -f infra/docker-compose.yml logs -f stalwart`

## Backup
See `docs/infra/BACKUP.md`. Stalwart data (volume `stalwart-data`) is the mail state
to snapshot; config (volume `stalwart-etc`) is configuration; the Postgres volume
holds product metadata.
