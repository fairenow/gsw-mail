# GSW Mail Superpowered MCP — Capability Expansion Plan

**Status:** Active implementation plan  
**Updated:** 2026-10-16  
**Repository:** [fairenow/gsw-mail](https://github.com/fairenow/gsw-mail)  
**MCP resource:** `https://api.guidedstepswellness.com/mcp`

## Purpose

Make GSW Mail a powerful, general-purpose Model Context Protocol (MCP) tool provider for ChatGPT and other authorized AI clients. **GSW supplies composable tools; the user determines the instructions, order, rules, and workflow.** We are not building a fixed church-outreach pipeline or other predetermined orchestration.

A user should be able to freely combine authorized operations: read email, research a prospect, search contacts, create a draft, generate or modify a file, attach it, create a calendar event, schedule an automation, and verify results—without replacing the MCP connection for each new capability.

## Operating principles

1. **Reuse the existing backend:** expose current domain services and `agentMailRegistry` tools rather than reimplementing them.
2. **Three levels of capability:** distinguish backend implementation, MCP exposure/authorization, and verified successful execution.
3. **Composable operations:** tools return stable IDs (`messageId`, `draftId`, `contactId`, `fileId`, `eventId`) and structured outcomes so the client can chain them in any order.
4. **Least privilege:** OAuth scope, active user capability grants, mailbox/account ACL, and action approval must all be enforced at invocation time.
5. **Accurate discovery:** never advertise a write tool as executable when the MCP transport still blocks it.
6. **No silent failures:** return actionable error codes, correlation IDs where available, and truthful delivery/execution statuses.
7. **One durable connection:** deploy new tools behind the existing MCP resource; refresh discovery and request new consent only when scopes actually change.

## Current state

- GSW Mail 2 has authenticated successfully and demonstrated account discovery, mailbox folder listing, and read-only email search.
- The existing backend agent registry contains broader functionality across mail, contacts, calendar, files, automations, campaigns, search, workers, and integrations.
- `apps/api/src/mcp/routes.ts` currently exposes **read-only** registry tools for execution; its explicit risk gate prevents write tools from running through MCP.
- The OAuth provider uses canonical automation scopes `automations.read` and `automations.write`; a previous connection requested obsolete singular names. The new connection works without creating another OAuth client.
- **PR #165:** `mail.list_recent` was merged, providing a proper newest-first listing path instead of relying on keyword search.
- **PR #166:** capability discovery work is open with CI pending at the time of writing. It adds `list_capabilities` to describe existing tools, required scopes, missing permissions, and write-transport restrictions.
- A prior ChatGPT session exposed 38 GSW operations. This is a snapshot, **not** proof of complete backend coverage or successful execution of every tool.

## Capability matrix — target tool surface

| Domain | General-purpose operations to expose or verify |
| --- | --- |
| Mail | List recent/search/read messages and threads; create/update/delete drafts; reply/forward; attachments; approved send; status and delivery errors |
| Contacts | Search/list/create/update/delete; tags; audience preview; import/export; deduplication support |
| Files and data | List/search/read; create/upload/update/move/rename/delete; analyze/transform; CSV and spreadsheet operations; attach files to drafts |
| Calendar | List events and availability; create/update/delete; invite attendees; RSVP status; reminders |
| Automations | List/create/update/pause/resume/delete; inspect run history, outputs, and errors |
| Campaigns | Create/edit/preview/launch/pause; audiences; recipient-level reports |
| Research and integrations | Public-web research, source-backed extraction, supported connector operations and imports/exports |
| Workers and workspace | Search across resources, delegate tasks, parallel work, inspect/review results |

**Important:** The matrix lists desired primitives, not a claim that all operations are implemented or callable today. Each tool needs a verified status: `implemented`, `MCP-exposed`, `OAuth-authorized`, `execution-tested`, or `missing`.

## Authorization model

| Class | Typical operations | Enforcement |
| --- | --- | --- |
| Read | Search mail, inspect contacts, list files | OAuth scope + current GSW capability grant + account ACL |
| Reversible write | Create drafts, edit contacts, update files | Write scope + account ACL + GSW approval policy, with auditable result |
| External / consequential | Send mail, launch campaigns, invite external attendees, destructive changes | Explicit GSW-verified approval at action boundary, idempotency for retry-sensitive operations, audit trail |

Do **not** trust client-supplied `approved: true` flags as approval evidence. Implement persisted, server-verifiable pending-action records and enforce them in the MCP call path. A token with `mail.send` alone must not bypass send approval. Revocation and scope downgrades must take effect on subsequent requests.

## Roadmap and acceptance

### Phase 1 — Inventory and discoverability

- Complete and verify PR #166; merge only after CI passes.
- Expose `list_capabilities` as an account-independent, read-only bootstrap tool.
- Generate an API-to-MCP gap matrix from the actual registry and service implementations.
- **Done when:** ChatGPT can accurately identify callable tools, blocked writes, and missing OAuth scopes.

### Phase 2 — Secure MCP write authorization

- Add persisted approvals for write/external actions, per-call validation, audit metadata, idempotency, and denial/revocation tests.
- Keep write tools disabled until these checks are implemented and verified.
- **Done when:** approved actions execute; unapproved, cross-account, replayed, or revoked calls fail safely.

### Phase 3 — Mail and contacts

- Expose existing draft create/edit/delete, reply/forward, approved sending, attachment management, and contacts CRUD.
- **Done when:** ChatGPT can create a draft, read it back, revise it, and send only after required authorization.

### Phase 4 — Files and data

- Expose file creation, uploads, editing, transformation, organization, CSV/spreadsheet handling, and attachments.
- **Done when:** a created artifact can be saved, retrieved, modified, and attached to a message.

### Phase 5 — Calendar and automations

- Expose event creation/editing, invitations, reminders, and automation CRUD plus execution history.
- **Done when:** operations persist and return inspectable IDs and execution outcomes.

### Phase 6 — Campaigns, research, integrations

- Surface existing campaign, research, and integration functions as **independent tools**, not mandatory outreach workflows.
- **Done when:** the client can choose and sequence operations freely with proper permissions.

### Phase 7 — Verification and rollout

- Run unit/integration tests, OAuth and account-isolation tests, MCP discovery tests, and real authenticated tool calls.
- Verify useful error responses, pagination, structured results, and approval behavior.
- **Done when:** tool descriptions match what the deployed MCP server can actually do.

## Immediate next actions

1. Check PR #166 CI and resolve any failures before merge and deployment.
2. Run `list_capabilities` through the existing GSW Mail 2 connection after deployment.
3. Audit existing write implementations and their scopes; prioritize exposing reusable mail-draft and contact operations.
4. Implement persisted approval and per-call authorization before enabling consequential writes.
5. Continue through files, calendar, automations, campaigns, and research, verifying each independently.

## Related documentation

- [Remote MCP architecture](REMOTE_MCP.md)
- [Full tool rollout and proposal architecture](MCP_FULL_TOOL_ROLLOUT.md)
- [OAuth and connected-app capabilities](../CONNECTED_APPS_OAUTH_CAPABILITIES_PLAN.md)

## North star

**GSW Mail provides secure, powerful, reusable capabilities. The user controls what the agent does, in what order, and under what rules.**
