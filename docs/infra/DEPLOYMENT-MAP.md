# Production deployment map

The mail platform is hosted across separate providers; Stalwart is the only workload
on dedicated mail hardware.

```text
Cloudflare    DNS / MX / SPF / DKIM / DMARC
Vercel        apps/web (mail.guidedstepswellness.com)
Railway       apps/api, outbound worker, send reconciliation
Neon          PostgreSQL product database (metadata/index, no canonical mail)
Hetzner Cloud Stalwart mail server (canonical mail, SMTP :25, JMAP :443)
Resend        outbound internet delivery
Cloudflare R2 off-site encrypted Stalwart backups
```

## Roles by provider

| Provider | Runs | Canonical? |
|----------|------|-----------|
| Hetzner | `mx1.guidedstepswellness.com` → Docker → Stalwart only | Yes — all mailbox data lives here |
| Railway | Fastify API, outbound worker, reconciliation, webhooks (one service until operational reason to split) | No |
| Neon | Product DB: users, orgs, memberships, aliases, outbound queue, recipient state, suppressions, audit, message index, delivery events | No |
| Vercel | Web shell; browser talks only to the API | No |
| Resend | HTTP API outbound; never direct-send from Hetzner in initial production | No |
| R2 | Encrypted backup target | No |

Separation rule: the rest of the stack may fail without preventing Stalwart from
accepting inbound mail. Postgres and recovery administration stay private; database
ports are never exposed. Optional protocols (587/993/465/4190) stay closed until
desktop/mobile mail-client support is explicitly required.

## Hetzner provisioning gate

Provisioning must not run before a read-only credentials check succeeds:

```bash
cp .env.local.example .env.local   # fill HETZNER_API_TOKEN; file stays gitignored
npm run infra:hetzner:check
```

`infra/hetzner/check.ts` loads `.env.local`, maps `HETZNER_API_TOKEN` to
`HCLOUD_TOKEN`, and runs read-only `hcloud server|ssh-key|location|server-type list`
calls (falling back to the Hetzner API when the CLI is missing). It never prints the
token and never creates infrastructure. Exit codes: `0` connected, `1` check failed,
`2` token missing.

## Provisioning (after the gate passes)

- Server `gsw-mail-mx1`: Ubuntu 24.04 LTS, shared ~2 vCPU / ~4 GB / 40–80 GB disk,
  public IPv4, hostname `mx1.guidedstepswellness.com`.
- Firewall: `22` SSH restricted to admin IPs, `25` SMTP public, `443` HTTPS/JMAP public.
- Bootstrap: install Docker, compose plugin, and backup tooling. Prefer idempotent
  scripts over the console.

## Order of operations

1. Hetzner token check (gate above)
2. Provision Hetzner server/firewall
3. Bootstrap Docker; deploy Stalwart; confirm JMAP health
4. Cloudflare A + MX records (DNS-only/grey, never proxied)
5. TLS; Stalwart domain/accounts; DKIM/SPF/DMARC records per DNS.md
6. Neon production database; run migrations (append-only from first production release)
7. Railway API with production secrets; confirm JMAP reads
8. Resend + delivery webhook
9. Vercel web app; custom domains for `mail.`/`api.mail.`
10. R2 encrypted backups; production acceptance tests

Backups are not complete until a restore has been exercised (BACKUP.md restore drill
targets this topology; the backup script asserts the `gsw-mail` compose project during
the interim single-host topology).