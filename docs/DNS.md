# DNS reference — guidedstepswellness.com

Goal: `Internet → MX → mx1.guidedstepswellness.com → GSW mail server → mailbox`.

> **Cutover:** retain current MX until live acceptance passes. Record the old values for rollback. Do not keep an old provider as backup MX unless it is explicitly configured to relay to the new system; otherwise mail can split between providers.

## Hosts

| Host | IP/Type | Purpose |
|------|---------|---------|
| `mx1.guidedstepswellness.com` | `A` → static public IP | primary mail server |
| `mail.guidedstepswellness.com` | `CNAME`/`A` | mail web app |
| `api.mail.guidedstepswellness.com` | `CNAME`/`A` | mail API |

## Records to add at the registrar / DNS provider

### MX
```text
Type  Host                          Priority  Value
MX    @ (guidedstepswellness.com)   10        mx1.guidedstepswellness.com
```

### A / AAAA
```text
Type  Host                    Value
A     mx1                     <static-public-ip>
A     mail                    <app-host-a>
A     api.mail                <api-host-a>
```

### SPF
Outbound uses Resend. Copy the exact SPF TXT and bounce MX records from the verified domain dashboard at its return-path hostname (normally a `send` subdomain). Do not replace the root inbound MX with the provider's bounce MX. Publish only one SPF record per hostname and retain all authorized senders during migration.

### DKIM

Publish the exact Resend DKIM selector/key for API outbound. Stalwart keys only cover mail that Stalwart signs; they do not substitute for Resend's signing records. If enabling Stalwart outbound later, publish its generated selectors too. Back up private keys with mail storage.

Source: [Resend domain configuration](https://resend.com/docs/dashboard/domains/introduction).

### DMARC
Start with `p=none` and monitor aggregates **before** enforcing:
```text
Type  Host                 Value
TXT   _dmarc               v=DMARC1; p=none; rua=mailto:postmaster@guidedstepswellness.com; ruf=mailto:postmaster@guidedstepswellness.com
```
Move `p=none` → `p=quarantine` → `p=reject` only after reviewing report volume and
confirming no legitimate sender is missing alignment.

### Abuse/mailbox-account addresses
Create delivered mailboxes/aliases early:
```text
postmaster@guidedstepswellness.com   # required by RFC 5321; also named in rua/ruf above
abuse@guidedstepswellness.com        # abuse reports
```
These must exist **before** DMARC policy is set to `quarantine`, or reports will bounce.

### Optional hardening
MTA-STS advertises policy that must itself be served over HTTPS at
`https://mta-sts.guidedstepswellness.com/.well-known/mta-sts.txt` — publishing the DNS
record (or TLSRPT) before that HTTPS policy is live makes remote MTAs expect a policy
that does not exist. Publish only when ready:
```text
TXT    _mta-sts.guidedstepswellness.com            v=STSv1; id=20260910
TXT    _smtp._tls.guidedstepswellness.com          v=TLSRPTv1; rua=mailto:postmaster@guidedstepswellness.com
TXT    _autodiscover.guidedstepswellness.com       v=autodiscover; ...   (later)
```

## Outbound sender expectations

With a relay provider, the provider gives SPF include + DKIM selector to add. When
moving to a self-hosted GSW outbound MTA later, add reverse DNS (PTR) for the IP and
warm IP reputation.

## Verification loop (Phase 1 completion)

1. `dig MX guidedstepswellness.com` → `mx1...`
2. `dig TXT guidedstepswellness.com` → SPF present
3. `dig TXT _dmarc...` → DMARC present
4. `dig TXT <provider-selector>._domainkey...` → DKIM present
5. Send from an external provider to `ramon@guidedstepswellness.com`; open in the
   Stalwart admin UI / web mail and confirm headers show `dkim=pass`, `spf=pass`,
   `dmarc=pass`.