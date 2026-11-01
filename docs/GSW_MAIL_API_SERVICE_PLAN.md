# GSW Mail mailbox API service plan

Updated November 1, 2026. First customer: Safe Place Ministries.

## Product decision

Provide one mailbox API, managed from the customer's GSW admin portal. The administrator creates a connection for a mailbox and issues a server API key. That key grants the mailbox's complete supported product capability set. There is no customer-facing checklist of individual tools, read/write scopes, workflows, or recipient addresses in the target design.

The admin portal manages the service; the external key operates the mailbox. This is the same administrative-versus-mailbox separation used by the MCP access profiles. It is not a promise that every MCP tool is already available over HTTP.

This decision supersedes the earlier proposals for granular API permissions, per-action installation grants, mandatory application registration, and OAuth-first external customer onboarding. More granular API products can be considered later; they are not prerequisites for this release. Existing OAuth, mobile, MCP and their authorization rules remain separate.

## Implemented versus intended

| Area | Implemented on the API pilot branch | Approved target; remaining work |
|---|---|---|
| Management | Workspace owner/admin can create, pause/resume and remove connections; create/list/revoke keys; removal revokes active keys while preserving audit history | API portal now links docs and production service/activity checks; commercial billing metering remains |
| Mailbox binding | Each installation names one mailbox in the workspace | Keep an explicit mailbox boundary; broad access inside that mailbox |
| Runtime API | Connection/capability discovery, mailbox operations, direct email/status and selected-model AI chat | Registry functions are exposed; inventory any UI-only capabilities still missing |
| Permissions | Full-mailbox keys; no recipient allowlist | Implemented; retain mailbox isolation and existing product rules |
| Sending | Atomic queue acceptance, idempotency, test simulations, quotas, suppression checks | Use the same mailbox sending abilities as the product, including dynamic recipients, replies, templates and attachments |
| Ownership | Connections remain usable after original administrator membership changes | Implemented; creator retained for audit |
| Mailbox credentials | Worker requires an existing authorized mailbox OAuth credential | Durable service access managed through the connection lifecycle, without unrelated browser-session dependence |
| Operations | Status polling, admin service health/activity, total and daily usage/capacity, active-key health, signed customer webhooks with retry/backoff, recovery and write reservations; uncertain sends quarantined | Commercial billing metering and deeper reconciliation remain |
| Deployment | Production live acceptance passed for connection, capabilities, mailbox reads, Kimi inference, external sending, idempotent replay and revocation | Continue customer integrations and close remaining parity/webhook work |

The current code implements the full-mailbox key and registry operation interface, and live-host acceptance has passed. Complete UI-to-API coverage is still being inventoried. [The pilot reference](integrations/email-api-pilot.md) is authoritative for requests accepted by the current branch. [The mailbox API guide](integrations/mailbox-api.md) describes the approved customer experience and remaining implementation.

## Administration and mailbox boundary

| Admin account / portal | External mailbox API key |
|---|---|
| Select a mailbox owned by the workspace | Operate only that connected mailbox and its associated product resources |
| Create, view metadata for, rotate and revoke keys | Read/search mail, compose, send, reply, forward, organize and delete messages |
| Pause/resume a connection | Use the mailbox's calendars, contacts, files, templates, settings and other available mailbox functions |
| Inspect usage, activity, errors and service health | Receive supported events and run authorized mailbox operations without an open chat |
| Read API docs, onboarding and examples | No workspace, domain, DNS, provisioning, billing or credential administration |

Creating a mailbox API key must not create a mailbox for the administrator. Workspace administration remains authenticated through the existing admin account. A mailbox key must never manage API keys, create/delete mailbox accounts, change other users' access, reset account credentials or administer domains. Deleting an email is a mailbox operation; deleting the mailbox account is administration.

One API means one base URL, one authentication method and one broad mailbox capability model. It can have many routes and multiple separately revocable keys. One key does not gain access to every mailbox in the workspace. A customer can connect additional mailboxes through the same API model.

## Capability coverage

The implementation backlog is parity with the current mailbox product/MCP capability inventory, excluding the admin profile. These categories describe coverage, not selectable permission tiers.

| Mailbox area | Target coverage |
|---|---|
| Inbox and messages | List, retrieve, search, threads, attachment download, read/unread, flags, move/archive/trash/delete |
| Compose and sending | Drafts, send, reply/reply-all, forward, cc/bcc, reply-to, templates, signatures, attachments, supported scheduled/recurring sends and status |
| Organization and preferences | Folders and supported mailbox rules/settings/preferences |
| Contacts and audiences | Contacts, address books, groups/subscriber records and supported consent/suppression behavior |
| Calendar | Calendars, events, availability where supported, invitations, RSVP and reminders |
| Files and media | Mailbox-owned files/folders, uploads/downloads, supported sharing and media operations |
| Campaigns | Mailbox campaigns/newsletters, preparation, scheduling, sending and results where supported |
| Tasks, AI and automations | Existing mailbox-owned task/chat, research, generation and automation abilities where supported by the product |
| Events and status | Connection health, operation status, mailbox activity and supported webhook subscriptions |

Inventory every existing mailbox function before declaring parity. Record the function, shared implementation, HTTP operation, test coverage and delivery status. Reuse the service behind a function; do not make the HTTP API imitate an MCP conversation or bypass execution rules. Missing underlying product abilities, such as public media publishing or booking conflict prevention, still require implementation before exposure can be described as complete.

All mailbox functions belong to the same grant. Extending the API to another mailbox function is coverage work, not another customer permission-selection flow. Keep the API version and capability documentation explicit when adding behavior.

## Authentication and customer onboarding

The initial customer path uses an admin-issued server API key. No external developer OAuth application registration or per-tool consent wizard is required to use this product. A future optional OAuth connection experience is a separate decision, not a dependency.

1. Customer signs into its GSW admin account and selects its workspace.
2. Customer finishes domain verification and creates a separate mailbox if needed.
3. In the planned **Admin → API** area, customer selects the mailbox, names its connection and creates a key. The key grants full mailbox access.
4. Customer saves the secret once in its website's backend secret settings. GSW stores a hash and display metadata.
5. Customer follows the linked API documentation and integrates supported operations using that mailbox.
6. Customer monitors production health, usage and activity and manages keys from the same portal.

The UI is now **Control Center → API**, with live mailbox connections, keys, documentation, service health, usage and activity. Rollout-only diagnostics and test-mode controls are no longer part of the normal production admin experience.

The website calls GSW from its backend. Public forms do not receive keys or get to choose arbitrary actions through an exposed proxy. The admin-authorized key is the authority for supported mailbox operations; do not introduce a per-request approval requirement merely because a website uses the API.

## Ownership and service continuity

The workspace owns the connection. Any currently authorized owner/admin can manage it under existing workspace rules. Store who created, changed and revoked it for audit, but do not make the original creator's continued employment or membership the sole runtime authority.

Changing workspace administrators should not require a new website integration when the workspace and mailbox remain the same. No separate transfer wizard is required initially; current admin membership should control management. Key revocation, connection pause, mailbox disablement and loss of valid mailbox ownership must still take effect.

Mailbox service access must not rely on an unrelated admin browser session remaining open. The implementation must support a durable, explicitly authorized mailbox connection through the MailEngine boundary, and surface reconnect-required health if its underlying authorization becomes invalid. Do not substitute the administrator's identity or give the external application mail-server admin credentials. The original-authorizer runtime dependency has been removed. The stored/refreshable mailbox-token dependency remains and is surfaced by the service check.

## Shared architecture and operational behavior

Website backend → unified mailbox API → authenticated mailbox context → existing shared product services → mailbox engine, storage and durable workers.

MCP and the website API can use the same service implementations, while retaining their own authentication paths. The API does not require an AI provider in the middle.

Retain ordinary service protections: mailbox/workspace isolation, secret hashing and revocation, input validation, verified sender identity, suppression/unsubscribe behavior, capacity limits, durable acceptance, duplicate prevention and auditable results. These are platform behavior, not customer-facing granular capability choices. The pilot's hardcoded limits are current implementation values, not final commercial plan decisions.

Keep transactional and marketing behavior consistent with the existing product. An inquiry is not newsletter consent. Templates, files and audiences stay owned by their mailbox/workspace; broad mailbox access does not authorize access to someone else's resources.

Use stable operation IDs, status and idempotency for supported writes. Accepted does not mean delivered. Keep uncertain sends quarantined until reconciled rather than automatically sending them again. Customer webhooks now use stable event IDs, HMAC signatures, retry/backoff, receiver-side dedupe guidance and public-HTTPS target validation. Ordinary webhooks remain separate from provider-specific MCP event delivery. Ordinary webhooks are separate from provider-specific MCP event delivery.

## Delivery sequence

1. **API foundation implemented and live acceptance passed:** one full-mailbox grant, remove pilot-only recipient/feature selections, workspace-owned administration, durable service authorization, admin API/docs entry point. Preserve existing isolation/reliability behavior while retiring customer-facing test-mode controls.
2. **Complete mail parity:** reading, search, threads, drafts, replies, message actions, templates, signatures, attachments and supported scheduling. Add operation tests and capability inventory as routes are implemented.
3. **Complete mailbox product parity:** contacts, calendars, files, campaigns, tasks/AI/automation and associated mailbox preferences through the same key. Do not add per-feature API plans or consent choices.
4. **Finish customer operations:** health, usage, activity, signed webhooks and connection removal are implemented; continue recovery, retention/deletion policy, richer key-expiration visibility and commercial metering. Define pricing separately from permission tiers.
5. **Prove Safe Place end to end:** persist inquiry and website outbox → owner notification → visitor acknowledgment → status in its admin. Then connect subscribers, calendars and media using the same API.
6. **Build owned workflows and the catalog:** versioned configurations and run history above existing mailbox services. Workflows organize behavior; they do not force a new API registration or feature-scope system.

Production migration and external mailbox acceptance have been established. Continue to require automated tests, deployment health and browser acceptance for each new customer-facing tranche. Service parity requires a test for every implemented mailbox operation, cross-mailbox denial and explicit denial of admin operations with a mailbox key.

## Documentation ownership

- This plan is the product direction and supersedes earlier API scope/registration proposals.
- [Mailbox API guide](integrations/mailbox-api.md) describes customer onboarding, portal management, capability coverage and current gaps.
- [Email API pilot reference](integrations/email-api-pilot.md) documents the existing routes, exact payloads, temporary restrictions and deployment prerequisites.
- Existing MCP and OAuth documents describe their own products. They must not be interpreted as requiring granular OAuth permissions for this admin-issued mailbox-key API.

Keep implemented contracts and intended behavior separate. Update both the API reference and parity inventory when implementation changes; never document an unimplemented route as available.
