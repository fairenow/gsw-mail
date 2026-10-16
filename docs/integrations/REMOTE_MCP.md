# GSW Mail Remote MCP Integration

Status: architecture and initial implementation contract; **not production enabled**.

## Purpose
Expose existing user-authorized GSW Mail capabilities to ChatGPT and Claude through **one** remote Model Context Protocol (MCP) server. Retain the current Fastify API, Stalwart JMAP mail engine, Neon Postgres product DB, R2 storage and persistent background task workers.

## Design

Client (ChatGPT / Claude) -> remote MCP (HTTPS Streamable HTTP) -> per-request OAuth resource/scopes + mailbox ACL -> existing GSW business services -> Stalwart / DB / R2 / durable jobs.

Preferred endpoint: `https://api.<GSW_HOST>/mcp` (hostname must be configured, not assumed).
Avoid local-only stdio as the production integration path. Avoid exposing the raw Stalwart or DB credentials to any MCP client.

## Repository review (2026-10-16)
- `apps/api/src/app.ts` runs Fastify and Better Auth OAuth-provider endpoints.
- `apps/api/src/auth/middleware.ts` currently trusts **only the mobile client** for product bearer API authentication, with `stalwartAudience`; do NOT relax this check for MCP.
- `apps/api/src/auth/better.ts` has an OAuth provider but `validAudiences` is currently restricted to Stalwart and supported scopes are OIDC-oriented.
- `apps/api/src/index.ts` manages asynchronous outgoing mail, AI tasks, automations and file organization workers.
- Existing product API routes cover mail, contacts, calendar and files. MCP handlers must reuse underlying domain services, not call privileged UI endpoints or reuse an admin token.

## Required auth changes before exposing /mcp
1. Define separate `GSW_MCP_RESOURCE` public HTTPS resource identifier and `GSW_MCP_AUDIENCE` and register it as an allowed OAuth resource.
2. Extend OAuth-supported scopes with least-privilege `mail.read`, `contacts.read`, `calendar.read`, `files.read`, `mail.draft`, `mail.send`, `calendar.write`, `tasks.write`, etc. OIDC scopes alone never imply mail permissions.
3. Validate token issuer, intended MCP audience/resource, expiration, revoked status, approved client, and every tool's required scopes. Resolve product identity and mailbox membership on every call.
4. Publish Protected Resource Metadata at the well-known resource endpoint and OAuth Authorization Server Metadata; support RFC 9728 discovery and Authorization Code with PKCE. Confirm client registration support with each client.
5. Enforce organizational and delegated mailbox ACLs in service calls. Never accept caller-supplied organization/user identity as authority.
6. Require explicit user approval at action boundary for external sends, event invitations, bulk work, and destructive operations; permission to connect does not constitute approval to send.
7. Token revocation, refresh, per-client connection management and security event audit must work before multi-user beta.
8. Explicitly block anonymous/dev-user fallback for MCP, including staging; never forward external bearer tokens into product middleware as first-party mobile tokens.

## Phase 1 read-only tools
`mail_search`, `mail_get_thread`, `contacts_search`, `calendar_list_events`, `files_search`, `task_get_status`.
Use bounded input schemas, pagination, clear error codes and limited output size. Redact message HTML/script content as untrusted tool response data.

## Phase 2 controlled writes
`mail_create_draft`, `mail_send_draft`, `calendar_create_event`, `calendar_invite_attendees`, `task_create` with user approval, idempotency keys, rate limits and audit events. Prefer prepare/confirm semantics for sends. Calendar RSVP must update the original event, not create a duplicate acceptance event.

## Phase 3 enhanced orchestration
Task status/progress and cancel tools should use the same durable backend worker state as web/mobile. A chat disconnect must not terminate approved durable work. Add rich MCP Apps UI only after tools and auth are solid.

## Definition of done
- MCP Inspector handshake, tools/list and tools/call succeed using test OAuth connection.
- Both ChatGPT and Claude can connect, read user's permitted mailbox and create a draft.
- Cross-user/mailbox probing returns authorization failure; no tool lists another user's messages.
- Revocation immediately blocks future calls; refresh works; scopes insufficient for send are rejected.
- Duplicate external send (retry/idempotency) does not deliver twice.
- External text in mail/attachments cannot override system instructions, request credentials, or trigger sends.
- Full integration test suite and production observability pass. Feature flag must default OFF until acceptance.

## Rollout
A: isolated tools contract + docs; B: OAuth resource and MCP transport; C: read-only beta; D: approved writes; E: scheduled work and rich UI.
