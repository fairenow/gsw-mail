# GSW Mail — Production Deployment Breakdown

## Deployment map

Use the existing stack wherever it fits, and use Hetzner only for the actual mail server.

```text
Cloudflare
  DNS / MX / SPF / DKIM / DMARC

Vercel
  apps/web

Railway
  apps/api
  outbound worker
  send reconciliation

Neon
  PostgreSQL product database

Hetzner Cloud
  Stalwart Mail Server
  canonical mailbox storage
  SMTP receive on port 25
  JMAP over HTTPS

Resend
  outbound internet delivery

Cloudflare R2
  off-site Stalwart backups
```

---

## 1. Hetzner — Stalwart only

The Hetzner server should have one primary responsibility:

```text
mx1.guidedstepswellness.com
        ↓
Hetzner VPS
        ↓
Docker
        ↓
Stalwart
```

Do not deploy the web app, product Postgres, AI workloads, or unrelated workers here.

Required public services:

```text
25   SMTP inbound
443  HTTPS / JMAP
```

Optional later:

```text
587  SMTP submission
993  IMAP
465  SMTPS
4190 ManageSieve
```

Keep those optional protocols closed unless we explicitly need standard desktop/mobile mail-client support.

---

## 2. Hetzner CLI initialization

The project already has:

```text
HETZNER_API_TOKEN
```

in `.env.local`.

Do not commit that file.

`.env.local` must remain gitignored.

Hetzner's official `hcloud` CLI expects the environment variable:

```text
HCLOUD_TOKEN
```

so our scripts/CLI commands should load `HETZNER_API_TOKEN` from `.env.local` and map it to `HCLOUD_TOKEN`.

Example shell initialization:

```bash
set -a
source .env.local
set +a

export HCLOUD_TOKEN="$HETZNER_API_TOKEN"
```

Then confirm the credentials work before provisioning anything:

```bash
hcloud server list
hcloud ssh-key list
hcloud location list
hcloud server-type list
```

The token is scoped to the Hetzner Cloud project where it was generated, so successfully listing project resources confirms the CLI is connected to the correct project.

The official CLI supports `HCLOUD_TOKEN` directly for scripted usage.

### Required first deployment task

The dev team should add a safe command/script such as:

```bash
npm run infra:hetzner:check
```

that:

1. loads `.env.local`
2. verifies `HETZNER_API_TOKEN` exists
3. maps it to `HCLOUD_TOKEN`
4. runs a read-only Hetzner API/CLI call
5. prints the project resources/account connection status
6. exits without creating infrastructure

Do not print the token.

---

## 3. Provision Hetzner infrastructure

After the credential check succeeds, provision:

```text
Server name:
gsw-mail-mx1

OS:
Ubuntu 24.04 LTS

Role:
Stalwart mail server

Resources:
Shared CPU
~2 vCPU
~4 GB RAM
40–80 GB disk

Networking:
Public IPv4 required

Hostname:
mx1.guidedstepswellness.com
```

Also create through Hetzner:

```text
SSH key
Firewall
Server
```

Suggested firewall:

```text
22   SSH - ideally restricted to admin IPs
25   SMTP - public
443  HTTPS/JMAP - public
```

Do not expose database ports.

If IMAP/submission are enabled later, explicitly add those ports then.

---

## 4. Hetzner provisioning should be repeatable

Prefer infrastructure scripts over manual console setup.

Suggested repo structure:

```text
infra/
  hetzner/
    check.sh
    provision.sh
    bootstrap.sh
    firewall.sh
```

or TypeScript equivalents if preferred.

Responsibilities:

### `check`

Read-only account/project validation.

### `provision`

Create:

```text
SSH key reference
firewall
server
labels
```

### `bootstrap`

SSH into the machine and install:

```text
Docker
Docker Compose plugin
required host packages
deployment directory
backup tooling
```

### `deploy`

Pull/build the Stalwart configuration and start the container.

Provisioning should be idempotent where practical.

---

## 5. Cloudflare — DNS

Cloudflare owns the DNS layer.

Records:

```text
A
mx1.guidedstepswellness.com
→ Hetzner IPv4
DNS only / grey cloud

MX
guidedstepswellness.com
→ mx1.guidedstepswellness.com
priority 10
```

Also configure:

```text
SPF
DKIM
DMARC
```

Do not proxy `mx1` through normal Cloudflare HTTP proxying.

---

## 6. Vercel — web app

Deploy:

```text
apps/web
```

to Vercel.

Production domain:

```text
mail.guidedstepswellness.com
```

The web app talks to the GSW Mail API through Vercel rewrites declared in
`apps/web/vercel.json`, proxying `/mail`, `/admin`, and `/health` to the
Railway-hosted API URL. No client-side `VITE_API_URL` is required; the browser
stays same-origin on the Vercel domain.

No Stalwart credentials should ever exist in Vercel client-side environment variables.

The browser talks only to the GSW Mail API.

---

## 7. Railway — API + worker

Deploy:

```text
apps/api
```

to Railway.

Initially use one Railway service for:

```text
Fastify API
outbound worker
send reconciliation
webhook processing
```

Do not split these into multiple Railway services until there is an operational reason.

Production domain:

```text
api.mail.guidedstepswellness.com
```

Railway environment should include:

```text
NODE_ENV=production
MAIL_ENGINE=stalwart

DATABASE_URL=<Neon connection>

STALWART_JMAP_URL=https://mx1.guidedstepswellness.com
STALWART_ADMIN_TOKEN=<secret>
STALWART_MAIL_USERNAME=test@team.guidedstepswellness.com
STALWART_MAIL_PASSWORD=<secret>

OUTBOUND_RELAY=resend
RESEND_API_KEY=<secret>
DELIVERY_WEBHOOK_SECRET=<secret>

JWT_ISSUER=<identity issuer>
JWKS_URL=<identity JWKS URL>
JWT_AUDIENCE=<mail audience>

SEND_DELAY_SECONDS=5
```

Plus any other production variables already enforced by `config.ts`.

---

## 8. Neon — product database

Use Neon for the GSW application database.

This database holds:

```text
users
organizations
organization memberships
mail account memberships
aliases
outbound queue
recipient delivery state
suppressions
audit logs
message metadata/index
delivery events
```

It does not hold canonical mailbox data.

Run migrations from the API deployment process or a dedicated migration job before releasing a new API version.

Run the production bootstrap seed (separate from the multi-user dev seed) on an
empty or existing production database:

```text
npm run db:seed:prod
```

It creates the organization, the `team.guidedstepswellness.com` domain, the owner
user, and the `test@team.guidedstepswellness.com` account with its mailboxes and
postmaster/abuse aliases. Override identities with `PROD_SEED_DOMAIN`,
`PROD_SEED_OWNER_ID`, `PROD_SEED_OWNER_SUBJECT`, `PROD_SEED_OWNER_EMAIL`,
`PROD_SEED_OWNER_NAME` when the GSW identity subjects are known.

Once production is initialized, migrations should be append-only.

---

## 9. Stalwart remains the canonical mailbox store

Canonical mail lives on the Hetzner/Stalwart server.

That includes:

```text
Inbox
Sent
Drafts
Trash
Spam
mail bodies
mailbox state
attachments
thread/mail objects
```

The rest of the GSW stack may fail without preventing Stalwart from accepting inbound mail.

That separation must remain intact.

---

## 10. Resend — outbound delivery

Railway should send outgoing internet mail through the Resend API.

```text
GSW API
   ↓
Neon queue
   ↓
Railway worker
   ↓
Resend HTTPS API
   ↓
recipient
```

Do not direct-send outbound mail from the Hetzner server during initial production.

We are intentionally outsourcing sender reputation and external delivery while owning the mailbox system.

---

## 11. Cloudflare R2 — backup target

Use R2 for off-site encrypted Stalwart backups.

```text
Hetzner
   ↓
backup job
   ↓
encrypted archive
   ↓
R2
```

Back up:

```text
Stalwart data
Stalwart configuration/state
recovery material required to restore service
```

Neon should use its own database recovery capabilities separately.

Backups are not considered complete until a restore has been tested.

---

## 12. Deployment order

Deploy in this order:

```text
1. Confirm Hetzner API token
2. Provision Hetzner server/firewall
3. Bootstrap Docker
4. Deploy Stalwart
5. Confirm JMAP health
6. Configure Cloudflare A/MX records
7. Configure TLS
8. Configure Stalwart domain/accounts
9. Configure DKIM/SPF/DMARC
10. Create Neon production database
11. Run migrations
12. Deploy Railway API
13. Configure Railway production secrets
14. Configure Resend/webhook
15. Deploy Vercel web app
16. Configure mail/api custom domains
17. Configure R2 backups
18. Run production acceptance tests
```

---

## 13. Required acceptance checks

Before real use:

```text
Hetzner:
hcloud access confirmed

DNS:
MX resolves correctly

SMTP:
external server can connect to port 25

Stalwart:
JMAP health succeeds

Inbound:
Gmail → GSW mailbox works

API:
Railway reads mailbox through JMAP

Outbound:
GSW → Resend → Gmail works

Webhook:
delivered/bounced events update state

Identity:
multiple users authenticate independently

Authorization:
private mailbox isolation works

Shared mailbox:
multiple delegates can read/send

Undo:
5-second Undo Send works

Attachments:
arrive intact

Backups:
backup completes

Restore:
test restore succeeds
```

---

## Final deployment architecture

```text
                         Cloudflare
                    DNS / MX / mail records
                           │
             ┌─────────────┴───────────────┐
             │                             │
             ▼                             ▼
      Hetzner Cloud                     Vercel
   mx1.guidedstepswellness.com     mail.guidedstepswellness.com
             │
          Stalwart
             │
             │ JMAP HTTPS
             ▼
          Railway
 api.mail.guidedstepswellness.com
      Fastify + worker
        │           │
        ▼           ▼
      Neon        Resend
        │
 product state   outbound delivery

Hetzner/Stalwart
        │
        ▼
 Cloudflare R2
   backups
```

## Immediate dev instruction

Before provisioning anything, use the existing:

```text
HETZNER_API_TOKEN
```

from `.env.local`, map it to the CLI-supported:

```text
HCLOUD_TOKEN
```

and run a **read-only Hetzner CLI check** to confirm that the repository can successfully reach the intended Hetzner Cloud project.

Only after that check succeeds should the provisioning scripts create the server, firewall, or any billable infrastructure.
