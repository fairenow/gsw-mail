# GSW Mail email API pilot

Status: current implementation reference for the API pilot branch; deployment and live-host acceptance still required. Only connection inspection, transactional email submission/status and admin key/connection management are implemented here.

**Product direction has changed:** the target is one full-mailbox API key managed in the admin portal, with no per-feature scope or recipient-selection flow. See [mailbox API customer guide](mailbox-api.md) and [the updated service plan](../GSW_MAIL_API_SERVICE_PLAN.md). The scopes, allowlist, single-email payload and original-authorizer dependency below describe existing code, not the final product requirements. Documentation changes do not remove these restrictions from runtime behavior. External OAuth registration is not a prerequisite for the approved key-based API.

## Current pilot setup (temporary restrictions)

1. Sign in as a GSW workspace owner or administrator. Create/verify the workspace domain and create a separate sending mailbox. Complete its mailbox login setup. Admin identities remain control-plane identities and are not turned into mailboxes.
2. Open **Control Center → Email Delivery**. Create a named website connection, choose its sending mailbox, and list exact approved recipients. Test mode is enabled by default. It persists simulated requests but never creates an outbound job or sends mail.
3. Create a server key. Copy it immediately into the website hosting provider's server-side secret settings. GSW retains only its SHA-256 hash and a display prefix. Keys created through the UI expire after 30 days. The admin API supports 1–90 days and narrower scopes.
4. Set `GSW_API_ORIGIN` to the deployed GSW API origin and `GSW_API_KEY` to the new key. Keep these out of frontend bundles, analytics, logs, and source control. Set `GSW_SENDER_ID` to the sender ID displayed in the connection panel.
5. Have the website server call the connection endpoint, submit a test message, and poll its status. Check request IDs and your own external record ID. Do not interpret a `202` as recipient delivery.
6. Before live sending, verify SPF, DKIM, and DMARC in GSW. Sign into the sending mailbox through the existing GSW mailbox OAuth flow so a refreshable mailbox credential is available. The worker uses that authorized mailbox identity, not the workspace admin's identity or the external API key as a mail-server credential. Missing credentials produce `mailbox_authorization_required` or `mailbox_reconnect_required` rather than privileged fallback.
7. Create a separate live connection with a small approved recipient list, initially ministry staff. The mailbox must be active, ready, and on the same workspace's verified domain. The server must use the Stalwart mail engine and relay; a demo/null transport cannot accept live integration sends.
8. Test one staff notification and confirm the real mailbox received it. Inspect submitted versus delivered status. Verify retries do not create another request; pause the connection and verify new work is blocked. Only then configure the website's production outbox.

The current pilot supports **owner notification of a persisted inquiry** to an approved ministry address. Full mailbox sending, including dynamic visitor recipients, is the approved next implementation direction; it does not require a new customer permission-selection system. Until that change ships, the existing allowlist still applies. An inquiry does not grant newsletter consent.

## Implemented pilot endpoints

All routes require `Authorization: Bearer <server-key>`. Browser session cookies and mobile/MCP OAuth tokens do not authenticate these endpoints. Errors use `{ "error": { "code", "requestId", "retryable" } }`; responses are `Cache-Control: no-store`.

| Method and path | Scope | Behavior |
|---|---|---|
| `GET /integrations/v1/connection` | `connection.read` | Installation, sender, exact recipient allowlist, test mode, daily limit, key scopes |
| `POST /integrations/v1/emails` | `email.send` | Durably accept a transactional request; require `Idempotency-Key` |
| `GET /integrations/v1/emails/:id` | `email.read` | Read only this installation's request, processing and delivery state, correlation metadata |

Example request (from the website's server):

```ts
const response = await fetch(`${process.env.GSW_API_ORIGIN}/integrations/v1/emails`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${process.env.GSW_API_KEY}`,
    "Content-Type": "application/json",
    "Idempotency-Key": `inquiry:${inquiryId}:owner-notification:v1`,
  },
  body: JSON.stringify({
    senderId: process.env.GSW_SENDER_ID,
    to: ["office@your-ministry.example"],
    subject: "New ministry inquiry",
    text: "A new inquiry is ready in your website admin portal.",
    metadata: { externalRecordId: inquiryId },
  }),
});
const result = await response.json();
if (!response.ok) throw new Error(result.error?.code ?? "gsw_request_failed");
// Persist result.id with the website's outbox job; poll for completion.
```

Supported payload: sender UUID; 1–10 recipient addresses; subject (1–998 characters without control characters); required text (up to 100,000 characters); optional HTML (up to 100,000 characters), reply-to email, and up to 10 string metadata entries. Unknown properties, including custom `from`, cc/bcc, attachments, and template requests, are rejected. Route body limit: 256 KiB. Addresses normalize to lowercase.

The accepted response includes `id`, `testMode`, `idempotentReplay`, `requestId`, `status`, and a Location header. `status` is `simulated` in test mode or `accepted_for_processing` in live mode, including retries. Poll the status URL for the current result; an acceptance response does not claim queued work is still pending when replayed.

Status returns the request ID, test flag, processing status, deliveryStatus, failureCode, submission/delivery dates, creation date, and customer metadata. Test status is `simulated` / `not_sent`. Live processing uses `queued`, `sending`, `submitted`, `failed`, or `cancelled`. `submitted` means accepted by the transport, not delivered to the recipient. Delivery status uses the existing delivery event pipeline and may remain `pending` until there is evidence. Neither delivered nor submitted proves inbox placement or reading.

## Reliability and limits

- Persist the website inquiry and its local outbox entry before calling GSW. Retry temporary API failures using the same idempotency key and identical payload. Do not choose a fresh key merely because a request timed out.
- Idempotency is installation-scoped and bound to the validated payload. A changed payload under the same key returns `409 idempotency_conflict`. Records currently have no automatic expiry, so keys remain reserved for the lifetime of their request record.
- GSW creates the integration request, outbound message, and recipients in a single transaction before returning `202`. A failure rolls all of them back. Test mode persists only the request.
- Default quota: 100 new accepted requests per installation per UTC day; administrator-selected API limit: 1–1,000. Simulations count toward the daily quota. Replays do not. Existing mailbox per-minute/per-hour limits also apply to live requests. `429` includes Retry-After; daily quotas reset at UTC midnight. Usage is currently quota accounting, not billable usage reporting.
- The pilot has an exact recipient allowlist. It cannot act as an arbitrary-recipient mail relay. Suppressions are checked before acceptance and again before dispatch.
- Workers recheck the key, its expiry/scopes, installation state, original authorizing administrator's active workspace access, mailbox/domain readiness, recipient policy and suppressions. Creating a replacement key does not transfer old queued work: revoking or expiring its original key prevents that work from dispatching.
- Revocation/pause prevents subsequent authorization checks. It cannot recall a request already handed to the transport. Keep this distinction visible in customer support.
- Integration sends whose dispatch lease expires are quarantined with `submission_unknown`. Ambiguous transport outcomes are also quarantined. Ordinary mailbox retry cannot requeue integration failures. An operator must inspect submission records and reconcile before deciding to make a new send. Never promise exactly-once delivery.
- Temporary failures before submission can retry through the existing worker. Failed policy checks surface a stable failure code. Raw failure details and private message bodies are not returned by the public API.

## Existing admin management API (not callable with mailbox API keys)

These endpoints require the existing GSW signed-in product session and workspace owner/admin permission, not an integration key. They live behind the Control Center panel.

| Method and path | Request |
|---|---|
| `POST /api/admin/integrations` | `organizationId`, `accountId`, `name`, `testMode` (default true), `allowedRecipients` (1–100), `dailyLimit` (default 100) |
| `GET /api/admin/integrations?organizationId=...` | List authorized workspace installations |
| `PATCH /api/admin/integrations/:id` | `{ "active": false }` to pause; true to resume |
| `POST /api/admin/integrations/:id/keys` | `name`, `scopes`, `expiresInDays`; returns secret once |
| `GET /api/admin/integrations/:id/keys` | Metadata only: ID, name, prefix, scopes, expiry, revocation and creation dates |
| `DELETE /api/admin/integrations/:id/keys/:keyId` | Revoke rather than delete the credential |

Rotate by creating a new key, updating the website's server secret, checking connection health, letting existing work settle, then revoking the previous key. To change a sender, recipient grant, or test/live mode in the pilot, create a new installation. Pause the old installation after cutover. This is a current pilot limitation. The target grants full mailbox functionality and does not add a granular permission editor.

## Deployment and acceptance

1. Apply `0041_integration_email_api.sql` using `npm run db:migrate --workspace apps/api` before deploying this API/worker version. The migration was executed in the isolated PostgreSQL-compatible test fixture. The configured local PostgreSQL server was unavailable, so no deployment database migration has been confirmed.
2. Deploy the API, outbound worker and web build together. The new tables are required by the outbound worker as well as the new routes. Do not run the new worker against an unmigrated database.
3. Forward `/integrations/*` to the API on the production host, or use the API's own origin. The Vite development proxy includes this path. Confirm HTTPS and authorization headers survive the reverse proxy.
4. Complete the customer setup above, then run the controlled live send, status and revocation acceptance checks. No production sender, recipient grant or key has been provisioned by this implementation.
5. Monitor failed/quarantined sends and validate the existing Stalwart delivery events before describing delivery reporting as operational for a customer.

Implemented tests use Fastify injection and a PostgreSQL-compatible database: migration execution, durable simulated acceptance, duplicate/reordered requests, changed-payload conflicts, installation isolation, strict validation, scope/expiry/revocation, pause/suspended grants, quotas, suppression, atomic rollback, live enqueue without network send, dispatch-time policy rechecks, and stale-lease quarantine. API and web typechecks/build are part of validation. These do not substitute for live mailbox acceptance.

## Next implementation work

Replace narrow pilot scopes and mandatory recipient allowlists with one full-mailbox grant; keep the explicit mailbox/workspace boundary. Make connections workspace-owned and manageable by existing admins without runtime dependence on the original creator. Complete durable mailbox service authorization and consolidate API keys, service information and documentation in the admin portal. Expose all available mailbox functions through the same API, then add health/activity/usage, signed webhooks and recovery tools. No external OAuth app registration or per-feature permission builder is required for this key-based product.

The [mailbox API guide](mailbox-api.md) owns the customer-facing direction; this document remains the exact existing pilot contract until implementation changes.
