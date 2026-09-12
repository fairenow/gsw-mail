# DNS reference — guidedstepswellness.com

Goal: `Internet → MX → mx1.guidedstepswellness.com → GSW mail server → mailbox`.

Mailboxes live on the isolated subdomain `team.guidedstepswellness.com`. The apex
`guidedstepswellness.com` remains on the existing Google Workspace and is NOT part of
the GSW cutover (no apex MX/SPF changes unless the owner approves).

> **Cutover:** retain current MX until live acceptance passes. Record the old values for rollback. Do not keep an old provider as backup MX unless it is explicitly configured to relay to the new system; otherwise mail can split between providers.

## Hosts

| Host | IP/Type | Purpose |
|------|---------|---------|
| `mx1.guidedstepswellness.com` | `A` → static public IP (Hetzner `2.28.120.166`) | primary mail server |
| `mail.guidedstepswellness.com` | `A`/proxied | mail web app (Vercel) |
| `api.mail.guidedstepswellness.com` | `A` | mail API (Railway) |

## Records to add at the DNS provider (mail domain = `team.`)

### MX
```text
Type  Host            Priority  Value
MX    team            10        mx1.guidedstepswellness.com
```

### A / AAAA
```text
Type  Host                    Value
A     mx1.guidedstepswellness.com   2.28.120.166    (DNS-only, not proxied)
A     mail                   <app-host-a>   (Vercel)
A     api.mail               <api-host-a>   (Railway)
```

### SPF
Outbound uses Resend. Copy the exact SPF TXT and bounce MX records from the verified
domain dashboard at the `send` host of the return-path domain. The Resend DKIM selector
sits under `resend._domainkey` in the apex verified domain. Publish only one SPF record
per sending hostname and retain all authorized senders during migration.

### DKIM

Publish the exact Resend DKIM selector/key for API outbound. Stalwart keys only cover
mail that Stalwart signs; they do not substitute for Resend's signing records. If
enabling Stalwart outbound later, publish its generated selectors too. Back up private
keys with mail storage.

Source: [Resend domain configuration](https://resend.com/docs/dashboard/domains/introduction).

### DMARC
Start with `p=none` and monitor aggregates **before** enforcing:
```text
Type  Host    Value
TXT   team._dmarc   v=DMARC1; p=none; rua=mailto:postmaster@guidedstepswellness.com; ruf=mailto:postmaster@guidedstepswellness.com
```
Move `p=none` → `p=quarantine` → `p=reject` only after reviewing report volume and
confirming no legitimate sender is missing alignment.

### Abuse/mailbox-account addresses
Create delivered mailboxes/aliases early:
```text
postmaster@team.guidedstepswellness.com   # required by RFC 5321
abuse@team.guidedstepswellness.com        # abuse reports
```

### Optional hardening
MTA-STS advertises policy that must itself be served over HTTPS at
`https://mta-sts.team.guidedstepswellness.com/.well-known/mta-sts.txt` — publishing the
DNS record (or TLSRPT) before that HTTPS policy is live makes remote MTAs expect a
policy that does not exist. Publish only when ready:
```text
TXT    _mta-sts.team.guidedstepswellness.com            v=STSv1; id=20260910
TXT    _smtp._tls.team.guidedstepswellness.com          v=TLSRPTv1; rua=mailto:postmaster@guidedstepswellness.com
TXT    _autodiscover.team.guidedstepswellness.com       v=autodiscover; ...   (later)
```

## Outbound sender expectations

With a relay provider, the provider gives SPF include + DKIM selector to add. When
moving to a self-hosted GSW outbound MTA later, add reverse DNS (PTR) for the IP
(`2.28.120.166` → `mx1.guidedstepswellness.com`) and warm IP reputation.

## Verification loop (Phase 1 completion)

1. `dig MX team.guidedstepswellness.com` → `mx1.guidedstepswellness.com`
2. `dig TXT send.team.guidedstepswellness.com` → Resend SPF present
3. `dig TXT team._dmarc...` → DMARC present
4. `dig TXT resend._domainkey...` → DKIM present
5. Send from an external provider to `test@team.guidedstepswellness.com`; open in the
   Stalwart admin UI / web mail and confirm headers show `dkim=pass`, `spf=pass`,
   `dmarc=pass`.