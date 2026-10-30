# GSW Mail API service and customer onboarding

Proposed specification • October 30, 2026 • First customer: Safe Place Ministries

## Purpose and status

Turn GSW Mail’s existing communication capabilities into a supported service that external applications can connect to. Start with transactional email, prove the customer installation model, and extend the same model to contacts, calendars, files, and configurable workflows.

This is a design and implementation plan, not a claim that these endpoints or onboarding screens exist. No repository changes or production enablement are included in this document.

Verified foundation: GSW exposes MCP tools for sending and for templates, contacts, and campaigns. The current product API middleware explicitly restricts OAuth bearer authentication to the first-party mobile client. This prevents treating an arbitrary external app’s OAuth token as product API authorization. Source inspected October 30, 2026: https://github.com/fairenow/gsw-mail/blob/main/apps/api/src/auth/middleware.ts

Other delivery, billing, webhook, and developer-access capabilities need an implementation audit before reuse. Tool exposure alone does not establish a production-ready external API.

## Service boundary

| Layer | Responsibility |
|---|---|
| External web app | Visitor experience, local business records, consent capture, server-side API calls, customer-facing status |
| GSW integration API | Authenticate connections, enforce scopes and resources, validate requests, accept durable work, report status |
| Shared GSW services | Send messages, manage templates and contacts, enforce suppression and sender rules, execute supported actions |
| Delivery workers | Process accepted work, retry temporary failures, record provider results |
| Event delivery | Send signed status notifications to registered customer endpoints |
| MCP | Let authorized assistants manage the same services and workflows |

Website → website backend → GSW integration API → durable job → shared sending service → delivery infrastructure.

Delivery results → GSW status records → signed webhook → website backend.

MCP calls the same shared service layer. A website does not need an AI provider or an open chat to send a confirmation.

## Identity and ownership model

| Object | Meaning | Lifecycle |
|---|---|---|
| Customer workspace | Organization responsible for usage and resources | Owns installations, senders, usage, and billing |
| Integration application | Identity of the software connecting to GSW | Registered once per independently operated integration |
| Installation | One customer’s grant to that application | Connect, restrict, rotate credentials, pause, revoke |
| Credential | Server-side authority for an installation | Expiring or rotatable; independently revocable |
| Workflow | Owned configuration using approved capabilities | Create and version within an installation |
| Message/job | One accepted unit of work | Queued, processed, result recorded |

A reusable connector can serve many websites through isolated installations. Each customer still authorizes its own resources. New workflows do not create new OAuth applications. An independently operated developer registers its own application rather than borrowing another developer’s identity.

Effective access is the intersection of the authorizing user’s access, application permissions, installation resources, credential scopes, and any workflow restrictions. No prompt or request field can enlarge that grant.

## Authentication products

Offer two deliberate paths, using a common authorization model underneath:

1. **Own application:** a workspace administrator creates an installation and a scoped server API key. Suitable when the website and GSW account have the same owner. Store only a hash of the key; show the secret once; support overlap during rotation, expiration, and immediate revocation.
2. **Connect customers:** a registered integration uses an OAuth authorization-code flow with PKCE. Each customer selects a workspace and resources at consent. Store client credentials and tokens server-side; support refresh, revocation, and reconnect behavior.

API keys are an MVP option, not an existing verified capability. OAuth is required before offering a third-party “Connect GSW” experience. Never work around the current restriction by pretending to be the mobile client or allowing all OAuth clients into existing product routes.

Tokens must be issued for the integration API’s audience. Validate audience, issuer, expiry, scopes, installation state, and ownership at the resource boundary. Disconnect must block queued actions when they reach execution, not merely prevent new submissions.

## First API contract — proposed, not implemented

Use a versioned surface, initially `/integrations/v1`. Exact public base URL is a deployment decision.

| Operation | Example route | Purpose |
|---|---|---|
| Inspect connection | `GET /connection` | Installation status, effective scopes, permitted resources |
| Discover senders | `GET /senders` | Approved sender identities available to this installation |
| Send message | `POST /emails` | Validate and durably queue transactional email |
| Inspect result | `GET /emails/{id}` | Acceptance, processing, and delivery history |
| List templates | `GET /templates` | Accessible published templates and versions |
| Inspect usage | `GET /usage` | Current usage and applicable limits |
| Manage webhook endpoint | `/webhook-endpoints` | Register, verify, rotate signing secrets, pause |

An email request contains a permitted sender ID, recipients, subject and text/HTML or a template version with variables, optional reply-to, approved attachment IDs, and customer correlation metadata. Require an `Idempotency-Key` for sends. Do not accept arbitrary remote attachment URLs in the first version.

Example request body:

```json
{
  "senderId": "sender_example",
  "to": [{"email": "visitor@example.org"}],
  "templateId": "inquiry_acknowledgment",
  "templateVersion": 1,
  "variables": {"firstName": "Jordan"},
  "metadata": {"externalRecordId": "inquiry_example"}
}
```

Return `202 Accepted` only after durable persistence, with a GSW message ID and `queued` status. Accepted does not mean delivered. A successful downstream handoff is distinct from recipient-server delivery, and neither proves inbox placement or that a person read it.

Use a stable error envelope: code, safe explanation, request ID, and whether retry is appropriate. Distinguish invalid input, authentication failure, insufficient permissions, conflicting idempotency reuse, rate limit, and temporary unavailability. Document retry headers and backoff behavior.

Idempotency is scoped to the installation and operation. Store a request fingerprint: the same key and payload returns the original result; changed payload with the same key is a conflict. Publish the retention window. Guard against duplicate worker execution as well as duplicate HTTP requests. Reconcile ambiguous downstream send outcomes before retrying; do not promise exactly-once email delivery.

## Sending rules and operations

- Verify sender/domain ownership and required email authentication before production sending. The customer may select only authorized senders; inbound contact-form addresses belong in reply-to, not a spoofed from field.
- Separate transactional and marketing purpose. An inquiry or booking does not grant newsletter consent. Marketing must honor recorded consent, unsubscribe, and suppression.
- Enforce recipient, message-size, attachment, concurrency, and usage limits on the server. Avoid logging bodies, secrets, or ministry inquiry details by default.
- Track queued, processing, submitted, delivered, bounced, failed, and suppressed outcomes where supported by delivery evidence. Track complaints when the delivery provider supplies them.
- Reuse existing queue and delivery infrastructure only after auditing it. Add reconciliation for uncertain outcomes and an operator path for failed jobs.
- Provide isolated test mode. It must not accidentally send to unrestricted real recipients; use simulated events or an explicit verified-recipient allowlist.
- Attribute usage to customer, installation, and credential. Define billable units, quotas, overage behavior, abuse response, retention, and support ownership before production launch. Pricing amounts remain undecided.

## Webhooks and synchronization

Start with email accepted, submitted, delivered, bounced, and failed events as supported by the delivery infrastructure. Include a unique event ID, schema version, timestamp, installation ID, message ID, and customer correlation ID.

Sign the raw payload with an endpoint-specific secret and timestamp. Customers verify the signature and replay window before processing. Retry temporary failures with bounded backoff; expose attempts and controlled replay. Delivery is at least once and may arrive out of order: receivers deduplicate by event ID and use status history rather than blindly replacing newer states.

Validate callback destinations and restrict outbound access to prevent internal network requests. Verify endpoint ownership. Keep personal content out of event payloads when an authorized API read can retrieve it instead.

Ordinary customer webhooks are separate from any provider-specific MCP Events adapter. Provider event support requires its own current specification check and implementation; it is not a dependency for the first email API.

## External web app customer guide

This section describes the target onboarding experience after implementation.

| Step | What the customer/developer does | What GSW provides or validates |
|---|---|---|
| 1. Establish ownership | Create a GSW organization/workspace; choose its administrator and usage owner | Workspace and customer identity |
| 2. Choose connection type | Select own-app API access or register a reusable OAuth integration | Installation or application registration |
| 3. Register software | Supply app name, owner contact, website, exact redirect URIs for OAuth, and intended capabilities | App identity, approved configuration, test access |
| 4. Configure sender | Add and verify domain/sender and required DNS records | Verification status and permitted sender IDs |
| 5. Grant access | Select mailbox/sender and minimum scopes; for OAuth, each customer consents separately | Installation with explicit resource bindings |
| 6. Configure backend | Store secrets in the hosting secret store; implement connection checks and token refresh where relevant | Credential lifecycle and documented API contract |
| 7. Implement requests | Save business data first; queue sends with stable idempotency keys; retain GSW IDs | Durable acceptance and status lookup |
| 8. Receive results | Register HTTPS callback; verify signatures; deduplicate and reconcile events | Signing secret, test events, retry history |
| 9. Pass testing | Test successful sends, duplicate requests, revocation, failures, and reconnect | Test checklist and visible results |
| 10. Enable production | Select plan/limits and complete required sender and abuse checks | Production access, usage reporting, support route |
| 11. Operate | Monitor failures, rotate keys, honor consent, manage usage | Logs, incident visibility, replay and revocation controls |

No API secret or refresh token goes into a browser bundle. A public form calls the website backend; the backend validates and limits submissions, saves the record, then calls GSW. Do not allow an unauthenticated form to choose arbitrary recipients or arbitrary email content.

For OAuth onboarding, bind the callback to the initiating administrator with state validation and PKCE. Validate exact redirect URIs. A successful GSW login does not itself grant administration rights to the website.

The production approval policy should be published: what is automatic, what needs review, why access might be restricted, and how customers resolve it. Do not require manual review for every workflow or template.

## Safe Place Ministries reference installation

**Owner setup:** select the ministry workspace, verified sending identity, owner notification destination, reply-to policy, and approved acknowledgment template. Confirm who owns billing and operational alerts.

**First complete flow:**

1. Visitor submits an inquiry to Safe Place.
2. Safe Place validates the form and persists the inquiry plus an outbox job in one reliable operation.
3. A backend worker sends the owner notification through GSW using a key derived from the inquiry ID and action, such as `inquiry:{id}:owner-notification:v1`.
4. GSW validates the installation and sender, persists the message, and returns its ID.
5. Safe Place records that ID and shows queued status. Signed results update delivery status; polling/reconciliation handles missing callbacks.
6. An optional visitor acknowledgment uses its own action/key and an approved template. A contextual reply draft is a separate later workflow.

Keep sensitive inquiry text out of routine notification emails when an authenticated admin link suffices. Let the ministry choose approved context and retention; do not automatically copy all ministry records into GSW.

Safe Place’s admin needs a small Integrations panel: connection state, selected resources, last success, recent failures, reconnect, and disconnect. GSW Settings needs API connections/credentials, usage, webhook status, and later Mine/Available workflows. A visual workflow builder is unnecessary for the initial release.

After inquiry notifications work, add explicit subscriber synchronization and welcome email; then bookings and reminders; then media and campaigns. Each adds scopes and contracts only when its implementation is ready.

## Implementation milestones and acceptance

| Milestone | GSW work | Safe Place work | Completion evidence |
|---|---|---|---|
| 0. Audit | Trace auth, sender verification, queue, delivery events, suppression, usage | Trace forms, persistence, jobs, admin auth | Capability map with reusable code and gaps |
| 1. Own-app email API | Installation, scoped keys, send/status, idempotency, test mode | Backend connection and inquiry outbox | One real authorized notification; duplicate retry produces one accepted message |
| 2. Production operations | Signed webhooks, reconciliation, usage limits, rotation/revocation | Status handling, retries, failure UI | Outage recovery, webhook replay, revocation and tenant isolation checks pass |
| 3. Reusable customer onboarding | Registered applications, resource-bound OAuth, refresh/reconnect, developer guide | Connect GSW flow | Second independent customer connects without custom server changes |
| 4. Workflow foundation | Versioned configurations, stable actions, run history, templates | Bind approved ministry context and actions | One GSW template and one owned variation use the same services |
| 5. Additional services | Contacts, booking rules, files/media, campaign contracts | Integrate each customer workflow | Separate end-to-end acceptance per capability |

Milestone 1 makes Safe Place a controlled first API customer. Milestones 2–3 make the offering suitable for repeatable external onboarding. The marketplace follows proven installations.

Required checks include cross-workspace resource denial; revoked credentials and paused installations; expired OAuth and refresh failure; duplicate HTTP and worker execution; persistence before acceptance; provider timeout after possible acceptance; forged/replayed/out-of-order callbacks; unauthorized sender; suppression; limits; credential rotation; and accidental production sends from test mode.

## Data and maintainability

Use shared tables for applications, installations, credential metadata, resource grants, messages, idempotency records, webhook endpoints/deliveries, and usage. Add workflows, versions, runs, and actions only as the workflow feature is built. Audit existing schema first; these are logical entities, not instructions to duplicate existing tables.

All records carry tenant ownership enforced by service code and queries. Tags organize records; they do not authorize access. Reference existing mailboxes, contacts, templates, and files instead of copying them. Keep credentials separate from workflow definitions; exports and marketplace templates contain no private IDs or secrets. Document retention and deletion behavior for payloads, logs, and webhook history.

## Decisions before implementation

Recommended defaults: own-app scoped keys for the controlled pilot; OAuth for reusable customer connections; transactional email first; private workflows before marketplace publishing; fixed backend delivery with optional AI judgment above it.

Resolve during the audit: public API hostname, existing queue/provider capabilities, sender verification readiness, quota and retention values, billing approach, production approval policy, and which existing permission names can be reused. No particular quota, price, delivery guarantee, or launch date is committed here.
