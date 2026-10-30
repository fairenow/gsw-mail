# Mailbox API implementation reference

Updated October 30, 2026. This file retains its original pilot filename for existing links. It now describes the current full-mailbox key foundation and shared operation interface. Deployment and live-host acceptance are separate from code validation.

## Authentication and ownership

Use `Authorization: Bearer YOUR_SERVER_KEY` on `/integrations/v1`. An API key has full access to its bound mailbox, including supported writes; no feature scopes or recipient allowlist are selected. Legacy pilot scope/recipient columns are retained for schema compatibility but no longer restrict keys. Existing pilot keys therefore receive the same mailbox access model. Workspace/domain/DNS/provisioning/account credentials and API-key administration are excluded from the external key.

A connection belongs to its workspace. Current authorized owners/admins manage it through **Control Center → API**. The original creator remains in audit attribution, but removing that administrator does not disable the connection. Pausing the connection, disabling the mailbox or revoking/expiring its key blocks subsequent authorization. The mailbox identity and associated user resources remain separate from the admin identity.

Mailbox operations resolve the mailbox's current active owner, matching authentication identity and owner membership. Engine operations use the existing stored/refreshable mailbox OAuth authorization; an expired/revoked authorization still requires mailbox reconnection. This release does not mint mailbox credentials from an admin key or remove that underlying authorization dependency.

## Setup

1. Sign into the workspace admin account. Finish domain verification and create a separate mailbox with completed login setup.
2. Open **Control Center → API**, select that mailbox and name the connection. Test mode defaults on.
3. Create a server key, save the secret once in your website backend's secret settings, then open the linked API documentation. The UI issues 30-day keys; the admin API accepts 1–90 days. Only a hash and display prefix are stored.
4. Use the connection and capabilities endpoints to discover current coverage. Test connections simulate operation/AI requests and never invoke the tools or providers. Email simulation records a request but no outbound message.
5. For live operations, use an active, ready mailbox on the workspace's verified domain. Current live installation checks require verified SPF/DKIM/DMARC. Complete the mailbox OAuth authorization so engine operations can resolve its credential. Use the service check in the admin panel to inspect readiness/reconnect needs.
6. Test a real staff email and mailbox read, then connect the website backend. No secret belongs in browser bundles, public forms, source control or logs.

## External routes

| Route | Contract |
|---|---|
| `GET /connection` | Connection name, test mode, full-mailbox access, mailbox/sender and direct-email daily quota |
| `GET /capabilities` | Current mailbox registry functions, descriptions, input schemas and mutation indicator; admin functions omitted |
| `POST /operations` | `{ "name": "mail.list_recent", "arguments": { "limit": 10 } }`; use returned schemas for other functions |
| `POST /emails` | Durably queue a direct text/HTML email; require `Idempotency-Key` |
| `GET /emails/:id` | Only this installation's email request/status/metadata |
| `POST /ai/chat` | `{ "messages": [{ "role": "user", "content": "Draft a welcome message" }] }`; use the mailbox's selected AI provider |

Paths above are relative to `/integrations/v1`. The Vercel and Vite proxies route this prefix to the API. The ordinary `/mail`, `/product`, `/admin` and OAuth/MCP routes retain their own authentication; the mailbox key does not authenticate to them.

The operation interface exposes existing mailbox registry functions for mail, drafts/replies/message organization, contacts/calendar, templates, files, campaigns, research, tasks and automation where registered. Use `/capabilities` as the coverage source. It does not imply that every UI-only product feature has an operation yet. Existing product prerequisites and execution rules still apply. Caller-supplied identity/account/workspace/credential overrides and admin-worker selection are rejected, and nested registry calls retain the mailbox boundary.

API operations are explicit actions authorized by the key; there is no additional MCP per-tool scope or confirmation wizard. Test mode simulates them. Created automations/schedules have their own lifecycle: revoking the key does not delete records previously created through it. Pause/delete those records separately when retiring a workflow.

The AI endpoint performs text generation without tools. Use `/operations` for explicit mailbox actions. It uses the connected mailbox's saved AI model choice, respects AI-disabled settings and returns only final content/model, not provider reasoning metadata. Select **Kimi** in that mailbox's AI settings to use the server's `KIMI_API_KEY`. Provider credentials never reach the client.

## Writes and retries

Mutation operations require `Idempotency-Key` (1–200 letters/digits or `. _ : -`). The reservation is bound to installation, operation and canonical arguments. A repeated key does not execute again; changed arguments return `409 idempotency_conflict`. Replays return status (`completed`, `failed` or `in_progress_or_unknown`) plus a small resource reference, not cached private email/file bodies. Read the resource using its returned reference if you need its current content. An uncompleted reservation may reflect an interrupted action; investigate before creating another write.

Email requests contain `senderId` (the bound mailbox UUID), 1–10 `to` addresses, subject (1–998 characters, no control characters), required `text` (max 100,000), optional `html` (max 100,000), `replyTo` and up to 10 string metadata fields. Body limit: 256 KiB. Unknown fields are rejected. Complex sending, drafts, replies, templates and attachments use supported mailbox operations instead of additional fields on this simple direct-send route.

```ts
const result = await fetch(`${process.env.GSW_API_ORIGIN}/integrations/v1/emails`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${process.env.GSW_API_KEY}`,
    "Content-Type": "application/json",
    "Idempotency-Key": `inquiry:${inquiryId}:ack:v1`,
  },
  body: JSON.stringify({
    senderId: process.env.GSW_SENDER_ID,
    to: [visitorEmail],
    subject: "We received your inquiry",
    text: "Thank you for contacting the ministry.",
    metadata: { externalRecordId: inquiryId },
  }),
});
```

Email acceptance atomically persists the request, outbound message and recipients before `202`, with status `accepted_for_processing` or `simulated`. Status polling distinguishes queued/sending/submitted/failed/cancelled from delivery evidence. Submitted does not mean delivered or read. Identical email replays return the original request ID; idempotency records have no automatic expiry today.

Direct email submissions default to 100 per installation per UTC day (admin API range 1–1,000); simulations count, replays do not. These counters are not a commercial billing meter or a count of every mailbox operation. Existing global rate limits and mailbox sending limits still apply. `429` includes Retry-After. Sending checks suppressions at acceptance and dispatch. An inquiry is not newsletter consent.

Unknown direct-send outcomes and stale dispatch leases are quarantined as `submission_unknown`; ordinary mailbox retry cannot requeue them. The original submission key is checked before dispatch, including expiry/revocation. Already-submitted actions cannot be recalled. New queued work can use a rotated key; old queued email retains its original credential authorization.

## Admin management routes

These require a normal authenticated GSW workspace owner/admin account; an external mailbox key cannot call them.

| Route | Purpose |
|---|---|
| `POST /api/admin/integrations` | Create connection: organizationId, accountId, name, testMode (default true), optional dailyLimit |
| `GET /api/admin/integrations?organizationId=...` | List workspace connections |
| `PATCH /api/admin/integrations/:id` | Pause/resume with `{ "active": false/true }` |
| `POST /api/admin/integrations/:id/keys` | Issue full-mailbox key: name and optional expiresInDays; secret returned once |
| `GET /api/admin/integrations/:id/keys` | List safe credential metadata |
| `DELETE /api/admin/integrations/:id/keys/:keyId` | Revoke key |
| `GET /api/admin/integrations/:id/service` | Readiness/reconnect status, accepted direct-email count and recent email/write-operation summaries |
| `GET /api/admin/integrations/docs` | Plain-text developer quickstart and route guide linked from the portal |

## Deployment and remaining work

Startup now idempotently ensures integration tables before workers start, using migration 0041 with a transaction/advisory lock. The migration remains available through `npm run db:migrate --workspace apps/api`; it is safe after startup setup. The configured local PostgreSQL server was unavailable when that command was attempted; isolated database tests execute the migration successfully. Startup success and live acceptance still need observation after deployment.

Validate real mailbox reading, Kimi inference, mail delivery/status, revocation and admin-page operation in the deployed environment. Code tests use fixtures/mocked providers and do not prove live provider credentials or delivery. Customer signed webhooks, complete coverage of product features missing from the registry, richer usage/billing, reconciliation tooling and mailbox authorization lifecycle improvements remain work. See [service plan](../GSW_MAIL_API_SERVICE_PLAN.md).
