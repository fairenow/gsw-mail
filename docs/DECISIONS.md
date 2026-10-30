# Decisions

Status key: **adopted** · **proposed** · **revisit**

| # | Decision | Status | Rationale |
|---|----------|--------|-----------|
| 1 | **Mail engine: Stalwart Mail Server** (`stalwartlabs/stalwart`, v0.16) | adopted | Full stack SMTP/IMAP/JMAP/mail storage/DKIM/spam/ManageSieve in one Rust binary; active project; Docker image; admin UI for bootstrap. Avoids writing SMTP/IMAP/deliverability from scratch. |
| 2 | **Product layer: TypeScript** | adopted | Matches the existing Guided Steps Wellness ecosystem (Convex, Vite/React, Expo). |
| 3 | **Product DB: PostgreSQL 16 + Drizzle** | adopted | Product metadata only. Drizzle gives typed schema + generated SQL migrations. |
| 4 | **API framework: Fastify** | adopted | TypeScript-first, schema validation, plugin model, fast. |
| 5 | **Engine abstraction (MailEngine interface)** | adopted | API must remain stable while the engine behind it can be swapped (Stalwart now, another engine later). This is the Phase 3 abstraction boundary. |
| 6 | **Outbound via SMTP relay first; never synchronous sends** | adopted | Own the queue + delivery events; rent delivery until managing outbound IP reputation is operationally worthwhile. MVP uses Resend; SES/Postmark/Mailgun are drop-in relays via config. |
| 7 | **Stalwart access via JMAP** (adapter + session status check in repo) | adopted | JMAP is native to Stalwart v0.16 (its management API and admin UI are JMAP objects over `/jmap`), modern, JSON-based for the product layer. IMAP remains the external-client protocol, not the product path. |
| 8 | **Do not duplicate Stalwart's internal state in Postgres** | adopted | Postgres holds product metadata + an inbound-message **index** for product search/threading, not full mail state. |
| 9 | **Product messages are an index, not source of truth** | adopted | Full messages live in Stalwart. The product `messages` table caches metadata for search/threads/security metadata. |
| 10 | **AI above mail, never in the delivery path** | adopted | AI processing consumes mail events; it can never block receive/send. |
| 11 | **Multi-domain data model from day one** | adopted | `domains` is modeled separately so the platform can later host churches/ministries on their own domains without a rewrite. |
| 12 | **Identity = Better Auth sessions** | superseded | Better Auth sessions are the canonical user-facing identity. The original Stalwart OIDC bearer-token design remains historical only; Stalwart is mail infrastructure, not the login provider. |
| 13 | **Stalwart bootstrap: datastore config, no bootstrap template** | adopted | v0.16 dropped the first-boot `config.toml` bridge: it writes a small datastore-oriented `config.json` and all management/configuration lives in JMAP objects. Bind empty named volumes (`stalwart-etc`, `stalwart-data`) and drive via the admin UI/API. The legacy `config.toml.example` is kept only as a pre-v0.16 reference. |
| 14 | **Outbound sends are idempotent** | adopted | `clientRequestId` keys the outbound queue so a retried request never double-sends. Delivery webhooks record relay events idempotently (`providerEventId`). |
| 15 | **Production fails closed on configuration** | adopted | In production the API refuses to start on placeholder/default secrets, a missing webhook secret, or the `null` relay. Details in `config.ts` validation. |
| 16 | **Gmail-like send saga: reserve → save Sent → finalize** | adopted | `INSERT ... ON CONFLICT (accountId, clientRequestId) DO NOTHING` as `preparing` (atomic serialization point, stores the RFC Message-ID), engine `saveSent` inside the request, then mark `queued`. A crash mid-request is reconciled by a worker. Never send synchronously. |
| 17 | **Stable RFC `Message-ID` generated before any external op** | adopted | The send's `Message-ID`, `In-Reply-To`, and `References` are generated/preserved at the API and flow through saveSent and the relay headers, so view → reply/reference and provider matching keys stay consistent. |
| 18 | **Undo window via claim-time backoff** | adopted | `nextAttemptAt = undoUntil` (`SEND_DELAY_SECONDS`, default 5) and the worker claims only due jobs, so a `202` client can cancel before claim. `cancel` moves the Sent copy back to Drafts via the engine; `retry` re-queues only `failed` sends (no duplicate Sent copy). |
| 19 | **`transport_status` vs `delivery_status` split** | adopted | Transport (preparing/queued/sending/accepted/failed/cancelled) is owned by the queue/worker; delivery (pending/delivered/deferred/bounced/complained/partial_failure) is derived from recipient-level events. GSW internal retry re-queues; provider deferral is a delivery-level observation. |
| 20 | **Recipient-level delivery state + suppression list** | adopted | `outbound_recipients` tracks each envelope recipient; message `delivery_status` is derived. Hard bounces and complaints insert organization-scoped `delivery_suppressions`, which future sends check (rejected 409). |
| 21 | **Audit log (no message bodies)** | adopted | `audit_events` records account/alias/admin mutations with actor, org, resource, IP/UA. Never stores message content. |
| 22 | **Outbound attachment model before attachment sending** | adopted | `outbound_attachments` persists durable metadata + Stalwart attachment refs (binary bytes stay in Stalwart/object storage). Relay resolves binaries per §37; Postgres never stores the bytes. |
| 23 | **Delegation + alias lifecycle are audited management ops** | adopted | `POST/DELETE /mail/accounts/:id/delegates` (account owner, `manage`) and `DELETE /mail/aliases/:id` (org owner/admin) close the §10 audit gaps: `account.delegate_added/removed`, `alias.deleted`. Owner memberships are non-removable via the delegate endpoint. |
| 24 | **Server-side OAuth token exchange** | superseded | Replaced by Better Auth branded application sessions. The browser no longer redirects to Stalwart for normal login. |
| 25 | **Stalwart token validation** | superseded | Better Auth is the OIDC issuer; Stalwart validates short-lived asymmetric bearer tokens against Better Auth discovery/JWKS. No Stalwart account credential is used to inspect or read user mail. |
| 26 | **Mailbox ownership = memberships; login identity = Stalwart username** | adopted | `/mail/accounts` returns the accounts the resolved Neon user has `mailAccountMemberships` rows for — never "the account you logged in as" by itself. Production authentication idempotently provisions the matching Neon user, account, owner membership, and organization membership; the bootstrap seed only creates the organization/domain and an explicitly configured initial owner. |
| 27 | **Normal JMAP access is request-scoped** | superseded | Replaced by Better Auth-issued user-scoped OAuth access tokens. There is no Stalwart service credential, introspection account, or impersonation path for mail reads. |
| 28 | **Merged Contacts product with split ownership** | adopted | Stalwart is authoritative for standard contact identity and address-book membership through JMAP Contacts/JSContact. Neon stores `stalwartContactId` plus GSW-specific tags, notes, outreach metadata, engagement counts, custom fields, and CSV import history. |
| 29 | **Rich text is sanitized at both edges** | adopted | The browser sanitizes pasted/editor content for usability, while the API sanitizes signature, draft, and send HTML before persistence or engine submission. Plaintext is stored/generated alongside HTML for fallback delivery. |
| 30 | **Short-lived authentication and JMAP caches** | adopted | Existing identities skip provisioning; token introspection, active-user resolution, Stalwart engines, JMAP sessions, mailbox metadata, and product account-address resolution use bounded TTL caches. First-login JIT provisioning remains available without making normal mailbox traffic pay its transaction cost. |
| 31 | **Summary-first mailbox reads** | adopted | Inbox and thread lists request JMAP summary properties and previews only; message bodies, HTML, attachments, and headers are loaded on demand. OAuth and mailbox metadata requests are coalesced per API process, while message lists remain live for freshness. |
| 32 | **Stalwart owns calendar events** | adopted | Calendar and event CRUD uses request-scoped JMAP `CalendarEvent/set`; Neon continues to own product settings and signatures, but does not duplicate Stalwart calendar state. No calendar migration is required. |
| 33 | **Confirmed calendar scheduling notifications** | adopted | Virtual meeting URLs are stored as JSCalendar `virtualLocations`; invitees are JSCalendar participants. The UI confirms before enabling Stalwart `sendSchedulingMessages`, preventing accidental invitation email. |
| 31 | **Control-plane workspace setup is separate from mailbox access** | adopted | Workspace setup progress is persisted against the organization. Workspace administration can configure the workspace and domains, while mailbox content access remains governed by explicit mail-account memberships. |
| 32 | **Better Auth owns user-facing authentication** | adopted | GSW signup, email verification, password, one-time email access, and sessions are branded application flows backed by Neon. Stalwart no longer serves normal user login pages or OAuth redirects; it remains the mail resource engine behind the API. |
| 33 | **Additive tenancy normalization before table renames** | adopted | `organizations` remains the workspace parent and `email_accounts` remains the mailbox resource during migration. Explicit workspace and Better Auth foreign keys are added first; existing identifiers such as `ramon-prod` remain compatible until reads and writes are fully migrated. |
| 34 | **GSW owns managed mailbox recovery** | adopted | Mailbox recovery issues and sends a hashed six-digit token to the verified workspace owner recovery email, then creates or updates the Better Auth credential. Better Auth self-service recovery remains for control accounts; mailbox recovery never depends on a pre-existing Better Auth mailbox identity. |

## Open questions

- Attachment object storage provider (S3-compatible vs GSW-owned object storage).
- Whether outbound should ever route through Stalwart's own relay queue instead of
  the GSW queue (current: GSW queue is authoritative for MVP).
- Spam/ham learning and FBL-style complaint backchannels beyond the recorded
  `complained` delivery event.

## September 11 implementation handoff

Protected route scopes install authentication before their handlers. Admin operations require explicit organizationId: query parameters for admin GET and suppression/alias DELETE; body fields for suppression POST, account POST/PATCH and alias POST. Missing identifiers return 400; absent or insufficient organization membership returns 403. Account delegation remains governed by account-owner manage permission.

Stalwart access remains inside MailEngine. Product UUIDs resolve to email addresses, which must match visible JMAP session account names. Sent persistence precedes queue finalization; the worker fetches attachment blobs from the engine and retries missing blobs instead of sending incomplete mail. Outbound delivery uses Resend; signed webhook events accept svix-id and data.email_id. Production configuration rejects demo/null backends and placeholder credentials.

Verification commands: `npm run typecheck`, `npm test --workspace apps/api`, `npm run test:integration --workspace apps/api`, `npm run test:acceptance --workspace apps/api`, and builds in both apps. Integration and acceptance reset only gsw_mail_test. The deployment bundle, acceptance steps, backups and monitoring are documented in [DEPLOYMENT.md](infra/DEPLOYMENT.md). Docker image execution, real Stalwart interoperability, external delivery and restore drills remain target-host release gates.


### Post-auth account resolution

Better Auth sessions resolve through the existing product user ID, including migrated mailbox identities. Existing workspace roles remain unchanged. Missing owned-mailbox and workspace memberships are reconciled idempotently without touching Stalwart. Credential recovery updates membership identity only for the recovering product user. GET `/api/account/context` validates active mailbox/workspace linkage and credential readiness before returning a destination. The web auth gate keeps product pages unmounted until session and context resolution finish, uses the branded state-driven loader, and offers retry/sign-out on failure. Product API 401 responses stop the application behind the recovery screen rather than signing out automatically. Resolution requests time out after 15 seconds; success animation adds 450ms and respects reduced motion.

The exact `/mail` page rewrite must precede the `/mail/:path*` API proxy in Vercel. `/mail` and `/sign-in` serve the web entry point; nested mail resources continue to reach Railway. Deployment checks must verify the `/mail` HTML response as well as API health.

Account resolution now displays the supplied `/loading-animation-1.gif` while session/context requests are pending. Status copy remains driven by real progress. Success and reduced-motion preferences use the static logo; navigation does not wait for the GIF to finish.

### Better Auth OIDC mailbox access

Better Auth is the permanent OIDC issuer and signs asymmetric, short-lived access
tokens for the `stalwart` audience. Neon membership and mailbox readiness are
checked before the authorization-code exchange. The token email claim is the
complete mailbox address and Stalwart is configured with `claimUsername=email`;
there is no username domain, impersonation, shared credential, or global mail
service identity. Existing Stalwart principals and mail state are preserved.

## Responsive mail panels (adopted, September 2026)

Use independent vertical scroll areas inside a viewport-sized mail shell. Keep pagination in the list footer and use the existing 50-message limit/offset API. Below 1100px, folder navigation is an overlay so opening it preserves the selected list or message. Phone compose occupies the dynamic viewport; content length does not determine window height.


## 2026-10-07 — Calendar workspace and invitation delivery

- Calendar and Settings are pre-mounted inside the mail reading pane so sidebar switching does not require a full page transition or an intermediate loading screen. The future Chat workspace uses the same pane contract.
- Calendar attendees are entered as validated address chips. Enter and comma commit an address; duplicate addresses are normalized away.
- Event updates to attendees are sent through the GSW outbound mail queue, not through a local `mailto:` handler.
- Product-authored calendar invitation/update emails use the user's selected supported mail template when available, with GSW Mail event styling and an attached `text/calendar` invitation.
- Stalwart `sendSchedulingMessages` is disabled for product-created and product-updated events. This prevents Stalwart's server-branded scheduling email and RSVP web page from becoming the user-facing invitation experience.
- The attached iCalendar request remains interoperable with external calendar clients. GSW Mail also issues recipient-specific signed RSVP links to `mail.guidedstepswellness.com/calendar/rsvp`, where Yes / No / Maybe responses are recorded in the product database without exposing Stalwart branding.
- RSVP links use signed, expiring tokens and never mutate state on GET. Email buttons preselect a choice, but the recipient must explicitly confirm it on the GSW RSVP page so link scanners cannot accidentally record a response.


## 2026-10-07 — Initial AI chat boundary

- The first GSW Chat release is a server-side, no-action assistant. It can converse, draft, and rewrite text, but it cannot read mailbox contents, contacts, calendars, or files and cannot send, edit, schedule, or otherwise mutate product state.
- Hetzner Inference is called only from the Railway API. `HETZNER_INFERENCE_KEY` is never sent to or referenced by the browser bundle.
- The provider boundary lives under `apps/api/src/ai/`; the browser calls only `POST /product/chat`.
- The initial provider uses Hetzner's OpenAI-compatible endpoint at `https://inference.hetzner.com/api/v1`. Base URL, model, and timeout are environment-overridable.
- AI remains outside the critical mail delivery path. Missing credentials, provider outages, timeouts, or rate limits affect Chat only and must not prevent normal mail operations.
- Conversation history is client-held for this first release. The API accepts only user/assistant text turns and does not persist chat history.


## 2026-10-07 — Chat copy controls and transient inference retry

- Every visible user prompt and assistant response exposes the same compact overlapping-square copy control.
- Hetzner inference gets one automatic retry for transient failures: HTTP 429, provider 5xx responses, network failures, timeouts, or empty model responses.
- Non-transient provider failures are not retried.
- The browser request window is long enough to accommodate the single server-side retry; normal mail remains independent of AI availability.


## 2026-10-07 — Workspace menu routing and copy-ready email drafts

- The top-right account menu no longer links directly to legacy standalone Contacts or Settings routes. Mailbox, Contacts, and Settings now open the same in-pane workspace states used by the left navigation.
- When the account menu is used from a legacy standalone page, it returns to `/mail` and restores the requested workspace panel instead of navigating to another standalone route.
- AI email drafts are explicitly tagged by the server-side writing assistant and rendered as nested copy-ready email cards inside the assistant response.
- Each email draft card has its own copy control, while the overall assistant response retains a separate copy control with internal draft tags removed.


## Browser mailbox credential recovery

Mail and calendar requests reuse a verified persisted first-party mailbox credential and then try its verified refresh grant before falling back to interactive OAuth. This applies to browser sessions as well as sessionless callers; mailbox ACL and identity linkage checks run before credential selection. Native bearer fallback remains available. External MCP bearers are never substituted for mailbox credentials. This avoids making a cold browser request depend on a new authorization-code exchange through the public host when an existing grant is usable.

Interactive session failures return `mailbox_reconnect_required` with a reconnect instruction. Unexpected failures include the request ID and route in server logs. A failed mailbox load is displayed as unavailable rather than claiming the folder is empty. Production acceptance requires testing messages, folders, statistics and calendars with the same browser session after deployment; local checks alone cannot establish the cause of the reported production 500s.

The reported web regression was traced to unconditional OAuth account selection: Railway logged “Better Auth OAuth authorization did not return a code” after a JSON redirect. Internal authorization now invokes the local Better Auth handler in an async-local identity context, established only after the existing session identity assertion. The chooser is skipped only if the OAuth session user matches that context. External HTTP requests cannot set this context, and concurrent requests remain isolated. Both browser mail access and first-party credential brokerage use this path.


## Settings and template schema recovery

The template startup schema repair adds the nullable subject, preheader and body_text fields from migration 0037 to existing tables. Production template listing failed when these columns were absent. General settings and template catalog requests load independently so a template failure does not hide all preferences. Initial settings failures display an error and retry control.


## Signed Cloudflare asset delivery

GSW-owned R2 file downloads use the asset Worker when ASSET_EDGE_URL and ASSET_EDGE_SIGNING_SECRET are configured. Authorization remains in the API; the Worker verifies a short-lived signature before reading any cache or R2 object. Avatar and template logo routes request bounded WebP variants, and image previews request width 1600 while retaining original downloads. All original asset types can use edge caching; no mailbox data is put in a public CDN cache. See services/asset-edge/README.md for expiry, invalidation, range handling and fallback behavior. Vite content-hashed assets receive immutable caching headers.


## Workspace mailbox and user deletion

The Control Center mailbox list defaults to all domains and has a domain filter independent of the create-mailbox domain selection. Admin deletion requires an exact typed address/email confirmation and validates workspace authorization on the server. Workspace owners and the current actor are protected. Removing a workspace user removes that workspace membership and mailbox grants only; owned mailboxes must first be removed or reassigned, and memberships elsewhere are preserved.

Mailbox deletion first disables the app mailbox, verifies the exact local part, domain and User account type through the management engine, and requires Stalwart destruction confirmation before removing the mailbox and outbound app records. Server retention may preserve an archive. If server deletion fails, the mailbox stays disabled and can be retried; the address record is not silently removed. Deleting an isolated mailbox login also removes its auth identity unless it still has other mailbox grants or workspace administration roles. No live mailbox/user deletions are performed as deployment tests.


## Separate MCP administrative and mailbox connections

MCP derives account mode from the authenticated principal's live mailbox binding and active workspace memberships. A mailbox identity remains a mailbox connection even if it has a legacy workspace owner membership. A control-plane identity with an active owner/admin membership receives an administrative connection. Other identities receive identity-only access. No mode is accepted from client arguments.

Tool advertisement, capability discovery and direct/universal invocation enforce the same boundary. OAuth scopes are restricted to the mode before executing tools, including nested work. Admin inventory uses workspace-scoped tools without requiring a mailbox UUID. Existing server write gates, OAuth scope checks, mailbox grants and explicit confirmations remain in force. Scope availability does not imply that a corresponding write tool has been implemented or enabled.

The OAuth chooser labels verified device sessions by account type. Consent lists only eligible requested permissions, describes their effects and lists the registered tools requiring each permission; out-of-mode requests are explicitly excluded, and all other available permissions are shown as not requested. The consent endpoint requires an explicit scope set and rejects scopes inappropriate for the selected principal. Existing connections need reauthorization to display the new narrower consent and refresh client tool catalogs; execution-time boundaries also apply to old tokens.


## 2026-10-29: Complete MCP administration discovery and write access

Protected-resource metadata advertises every supported product scope, including all ten administration scopes. Previously it advertised only mailbox scopes, so a client could connect a workspace administrator with identity-only consent. Existing tokens are never silently upgraded. Admin tools/list without workspace.read and calls missing their required admin scopes now return HTTP 403 with a Bearer insufficient_scope challenge and requested scopes for a new authorization. Reconnect the plugin to request and explicitly approve these permissions; clients that cache an old scope configuration must refresh their OAuth configuration. Signed consent continuations and mailbox/admin separation remain enforced.

The admin inventory includes workspace/domain/mailbox/user reads, domain provisioning and verification, alias list/create/delete, mailbox creation/deletion, workspace user removal, infrastructure health and audit reads. Domain reads include DNS verification records. Every administration scope now maps to an implemented tool. Native admin user/mailbox deletion and MCP deletion share the same service and owner/self/owned-mailbox safeguards. User removal affects the selected workspace only. Domain removal and unsupported workspace settings are not advertised as implemented capabilities.

Administrative writes use the independent GSW_MCP_ADMIN_WRITES_ENABLED switch and live owner/admin roles, rather than a mailbox-specific owner test identity. Every write requires a fresh requestId and explicit confirmExternal=true, with durable idempotency. Deletions additionally require the exact address. This deployment explicitly enables administrative writes. Existing mailbox write gates and OAuth grants are unchanged. Persisted-approval enforcement, if enabled, still denies unsupported administrative writes.


Admin consent additionally offers an explicit full-administration scope upgrade when a client repeats a cached identity/mailbox-only scope request. This starts a fresh authorization-code request preserving client ID, registered redirect, state, S256 PKCE, nonce and resources; signature/expiry from the old continuation are not reused. Better Auth revalidates the new request and registered client scopes, then displays all admin permissions for separate explicit approval. Existing consent/token rows are never broadened directly. This avoids depending exclusively on the client's handling of insufficient_scope challenges.


## 2026-10-29: Mobile notification categories and durable delivery

Mobile push devices persist separate new-mail, calendar, chat-complete, scheduled/background-complete, and work-attention preferences. Calendar push lead time accepts 0–1440 minutes. Native registration no longer forces calendar off or overwrites other saved accounts' preferences. Existing category choices are preserved; newly added work categories default on. A separate user-level calendar-email preference works independently of device push permission. Native Settings has a Notifications section and a device-specific diagnostic push test. Calendar event editing exposes owner email reminder times and keeps attendee invitations distinct.

The API runs a 10-second durable notification worker. It discovers terminal chat commands, scheduled runs and background tasks, and uses a PostgreSQL outbox unique per source/user/device. It excludes completions preceding the rollout or device registration, checks current categories and account access before sending, bounds retries, and expires stale work. Expo acceptance is recorded separately from phone delivery; network ambiguity can still cause duplicate delivery across a worker crash. Data payloads carry source IDs to open the exact conversation or scheduled-run result under the matching saved identity. Result text is not included in completion push bodies. Outbox retention is 30 days.

Push calendar metadata is recorded on GSW event create/update and authenticated calendar reads, with deletion tombstones to avoid resurrecting cancelled reminders. Existing saved email reminder metadata can seed upcoming owner push events. Open Calendar to synchronize other existing/imported events; updates made outside GSW require a later authenticated calendar sync. Floating calendar starts are converted using the event time zone; JMAP reads now request that field. At-start reminders have a five-minute delivery window. The worker does not need an open mobile app after the schedule is synchronized.

Production diagnostics found three calendar-disabled push registrations and four reminder failures caused by direct Stalwart relay calls without a persisted email ID. Calendar reminders and opted-in automation summary emails now prepare their message through the user-scoped MailEngine/normal send flow before queueing outbound delivery. Renewable mailbox credentials and live send permission are required; missing authorization fails closed. Known pre-submission failures for future events are eligible for the corrected queue path; uncertain historical deliveries are not blindly resent. Reminder records marked sent indicate handoff to the outbound queue, whose delivery status remains authoritative. These changes do not enable attendee reminders or claim recipient delivery; invitations still require explicit per-event approval and the mail server's scheduling support.

Schema changes follow the API's existing idempotent startup-schema pattern. Validation includes embedded PostgreSQL discovery tests and independent notification category/time-zone tests. Physical iOS/Android delivery and third-party invitation receipt require device/provider acceptance tests after the mobile app is updated.

Production acceptance checks also verify raw worker SQL against the mapped user_status/account_status columns. Failed email reminder schedules remain visible in event editing so a delivery failure does not silently erase the configured reminder choices.
## 2026-10-29: Consent review and cross-tab account recovery

Admin consent uses a full-width primary action: Review all admin access when scopes are missing, then Approve all admin access on the complete review. Limited access remains an explicit secondary choice. All expandable permission and tool details live inside one fixed-height scrolling region, keeping the actions stationary.

The web auth gate checks the active identity on focus, visibility changes, and every 15 seconds while visible. If another tab changes the shared session, it explains the mismatch and lets the user explicitly restore the original saved device session without unmounting the open compose window. Missing or expired saved sessions require signing in again; workspace administration never grants mailbox content access.

## 2026-10-29: Calendar invitation branding

Calendar invitation and update emails use the GSW Mail favicon and their own layout rather than the sender's community or Bible template. The public RSVP page uses the same GSW Mail favicon. Existing email messages retain their previously rendered content.

## October 30, 2026 — Own-app email API pilot

Use a separate `/integrations/v1` authorization surface with installation-bound hashed keys; preserve the mobile-only product bearer trust rule. An installation grants one sending mailbox and explicit recipients, with simulation as the default. Live queued work uses persisted mailbox OAuth authority and the existing MailEngine/relay, rather than minting mail credentials from an admin or integration key. Keep request metadata separate from existing outbound payload records, persist acceptance atomically, and quarantine ambiguous submissions instead of automatically repeating them. Restrict the initial customer outcome to fixed ministry-owner inquiry notifications; defer dynamic visitor recipients, public OAuth onboarding, signed customer webhooks and billing until their own acceptance. The Control Center exposes connection, pause, key issue and revocation controls.

## October 30, 2026 — Admin-managed, full-mailbox API

Supersedes the earlier proposed granular API grant, fixed-recipient customer model and OAuth-first onboarding requirements. Provide one versioned mailbox API using admin-issued server keys. Each connection binds one mailbox and exposes its complete supported mailbox product capability set; customers do not choose per-tool/read-write scopes or recipient permissions. Workspace, domain, DNS, mailbox provisioning, account access and credential administration remain available only through their admin authorization paths, never the external mailbox key. Multiple keys and mailbox connections use the same API model.

Connections are to be workspace-owned and managed by current authorized admins; original creator identity belongs in audit history rather than being the sole ongoing service authority. The admin portal should contain API key/service management, information and docs. Existing runtime scopes, allowlists, original-authorizer checks and mailbox-token dependencies are still pilot behavior and must be replaced explicitly in code. Retain ordinary mailbox isolation, sender, consent/suppression, queue, validation and capacity behavior. Optional OAuth and granular APIs may be reconsidered later; neither is required now. The [updated plan](GSW_MAIL_API_SERVICE_PLAN.md) and [mailbox guide](integrations/mailbox-api.md) define this direction; [pilot reference](integrations/email-api-pilot.md) defines existing requests.

## October 30, 2026 — Full-mailbox operation interface and Kimi

Implement the approved mailbox access model by exposing the existing registry through discovery and operation endpoints under a mailbox-only execution boundary. Do not broaden the existing product bearer trust rule. Keep API context server-derived; reject caller identity/resource overrides and admin-worker selection. Reuse durable idempotency reservations for mutation operations and cache only resource references, not full mailbox/file bodies. Existing pilot key/recipient columns are legacy storage and no longer select permissions. Kimi joins the existing provider adapter interface, selected through saved mailbox settings with server-only credentials; preserve provider reasoning metadata for tool continuations without returning it to users. Deployment of these code changes still requires live acceptance.


## Public developer documentation and live diagnostics (2026-10-30)

The public documentation is served from `apps/web/public/docs` on
`mail-docs.guidedstepswellness.com` through host-specific Vercel Routing Middleware;
`/docs` on the mail host is a fallback. API traffic remains on the mail host.
The old authenticated docs endpoint redirects to the docs subdomain.
`GET /integrations/v1` provides public connection guidance, and `/reference`
exposes static mailbox operation schemas only. Private capabilities and all
mailbox execution still require a bearer key.

Control Center API includes an administrator-authorized, workspace-bound live
service diagnostic. It reads at most one message without returning its contents
and calls the selected AI provider plus Kimi when needed. It issues no API key
and sends no email. It is explicitly distinct from bearer-key acceptance and
recipient delivery checks. Diagnostic use is rate limited and audited.

DNS for the docs host must be configured at the authoritative DNS provider.
A successful build or deployment does not establish DNS, TLS or live acceptance.
