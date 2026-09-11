# Guided Steps Mail — Architecture

## 1. Principles

1. **Guided Steps Wellness owns its email infrastructure.** Not a Gmail clone.
2. **Rent delivery, own everything else.** Outbound starts behind a trusted SMTP relay;
   accounts, mailboxes, messages, sender identities, domains, business logic, UX, and
   data remain GSW-owned. Self-hosted outbound MTA is only a future option after the
   organization is prepared to manage IP reputation.
3. **Mail infrastructure is isolated from product logic.** The mail server must stay
   reliable even if AI, Convex, the website, a worker, or a third-party integration is
   down. Nothing in the critical mail path depends on product components.
4. **The API is the abstraction boundary.** Guided Steps products talk to the
   GSW Mail API. The engine behind it can be replaced without rewriting products.
5. **AI sits above mail, never inside the delivery path.** AI failure must never prevent
   delivery of normal email.

## 2. Domains

```text
guidedstepswellness.com        main website
mail.guidedstepswellness.com   mail application / user-facing interface
mx1.guidedstepswellness.com    primary mail server
api.mail.guidedstepswellness.com  mail application API
```

Future: `mx2.guidedstepswellness.com` (secondary MX). Kubernetes of the mail server
must not assume serverless; the engine needs persistent disk, a static/public IP,
the mail ports, uptime, and (eventually) reverse DNS.

## 3. System diagram

```text
                     GUIDED STEPS MAIL

                 guidedstepswellness.com
                          │
                          ▼
                      DNS / MX
                          │
                          ▼
                 Mail Infrastructure
                │
                 ┌────────┴─────────┐
                 │                  │
           Inbound SMTP        Outbound SMTP
                 │                  │
                 ▼                  ▼
           Mail Processing       SMTP Relay
                 │                  │
                 ▼                  ▼
            Mail Storage         Internet
                 │
                 ▼
            GSW Mail API
                 │
                 ▼
       Guided Steps Applications
```

## 4. Security boundary

```text
Public Internet
     │
     ▼
Mail Protocol Layer      (Stalwart: SMTP/IMAP/JMAP)
     │
     ▼
Mail Core                (Stalwart storage, routing, DKIM, spam)
     │
     ▼
Internal API             (GSW Mail API — this repo)
     │
     ▼
GSW Applications
```

The mail server is critical infrastructure and is **not** exposed directly to every
application. Only the internal API reaches it (via JMAP/imap with controlled
credentials). Administration endpoints require elevated authorization.

## 5. Responsibilities

### Mail engine (Stalwart)
- SMTP, IMAP, JMAP
- Mail storage and routing
- DKIM/DMARC/SPF validation and signing
- Spam processing
- Protocol authentication

### Guided Steps product layer (this repo)
- User experience, organizations, accounts, permissions
- Mail workflows (compose, reply, forward, archive, trash)
- Outbound queue and delivery-event ownership
- Search indexing at the product layer
- AI / automation / analytics / administration

### Database (Postgres)
- Product-level metadata only (organizations, domains, accounts, aliases,
  outbound queue, delivery events, inbound-message index).
- The mail server's complete internal state is **not** duplicated in Postgres.

### Object storage (future)
- Large attachments, exports, backups.

### Workers (future)
- Outbound queue, AI processing, indexing, notifications, bounce processing,
  scheduled jobs, maintenance.

## 6. Outbound flow (MVP)

```text
User sends message
       │
       ▼
Message saved to Sent (engine)
       │
       ▼
Outbound job created (status: queued)
       │
       ▼
Worker processes job (status: sending)
       │
       ▼
SMTP relay (Resend / SES / Postmark / Mailgun)
       │
       ▼
Delivery status returned
   (sent / delivered / deferred / bounced / failed)
```

Delivery events are retained. Message states:

```text
draft → queued → sending → sent → delivered
              ↘ deferred (retry)
              ↘ bounced
              ↘ failed
```

Never send application mail synchronously.

## 7. Inbound flow (MVP)

```text
Internet
   │
   ▼
guidedstepswellness.com MX
   │
   ▼
Stalwart inbound SMTP
   │
   ▼
Mailbox (RocksDB → Stalwart storage)
   │
   ▼
GSW Mail API (JMAP read)
   │
   ▼
Web / product applications
```

Incoming messages must support: plain text, HTML, attachments, multipart MIME,
reply headers, thread identifiers, sender/recipient metadata, CC, BCC where
available, and message timestamps.

## 8. Events

Mail activity produces structured events (Phase 8+.9 ready — not yet all wired):

```text
mail.received           mail.sent            mail.delivered
mail.bounced            mail.failed          mail.opened
mail.replied            mail.spam_detected   mail.account.created
```

Other Guided Steps products consume these. Email is shared infrastructure for the
broader ecosystem (community, bible, library).

## 9. Data ownership

Defined/owned by GSW:

```text
Message bodies   Attachments   Headers   Mailbox state
Thread metadata  Contacts      Search indexes   Delivery events
```

Storage must support backup and restoration. Attachments may move to object
storage rather than the primary database.

## 10. Failure isolation

The critical mail path (Stalwart inbound → storage → JMAP read; queue → relay outbound)
must not share runtime state with product components. If the API is down, Stalwart
continues to receive and store mail; mail only becomes visible again when the API
returns. If AI is down, mail does not notice.