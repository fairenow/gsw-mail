# Mailbox API: customer setup and admin management

Updated October 30, 2026. Full-mailbox keys, the API admin panel, registry operation discovery/execution and selected-model AI generation are implemented in code. Live deployment acceptance and coverage of any product features missing from the registry remain outstanding. See [the implementation reference](email-api-pilot.md) for exact routes.

## What the customer gets

One server API key connects an external application to one GSW mailbox and grants its complete supported mailbox functionality. Customers do not select individual tools, read/write scopes or recipient allowlists in the target setup. Multiple keys may be issued for rotation or different website deployments; all use the same mailbox API model.

A mailbox includes its associated mail, calendar, contacts, files, templates, signatures, campaigns, tasks, AI/automation and preferences where the product supports them. Exposure of all these functions is the implementation target, not the current API's available coverage. No separate API product is required for each area.

The key cannot administer GSW workspaces, domains, DNS, mailbox accounts, other users, billing, passwords or API credentials. The customer's admin account manages those responsibilities. Access to one mailbox never implies access to all inboxes in the workspace.

## Target admin experience

Provide an **API** area in the GSW admin portal with:

- Connections and their selected mailbox, status and name.
- Create-key, secret-once display, key metadata, rotation and revocation.
- Pause/resume controls and connection health/reconnect information.
- Operation activity, errors, usage and capacity information.
- API reference, quickstart examples, base URL and available capability documentation.

No per-feature permission builder or separate OAuth app-registration wizard is required. The existing owner/admin account is the service-management identity. A mailbox key itself cannot enter this admin area or create other keys.

The current **Control Center → API** panel creates connections/keys, supports pause/resume and revocation, links developer documentation, and offers service readiness/reconnect checks with accepted-email counts and recent email/write activity. These are operational summaries, not full commercial metering.

## Customer process

| Step | Customer action | Target result |
|---|---|---|
| 1 | Sign into GSW as a workspace owner/admin | Access the API-management area |
| 2 | Verify its domain and finish creating the separate mailbox | A valid mailbox to connect |
| 3 | Select that mailbox and name the website/service connection | Workspace-owned connection with full mailbox capability |
| 4 | Create an API key and save it in backend secrets | A secret shown once; only its hash retained by GSW |
| 5 | Read the linked quickstart and check connection health | Confirm base URL, mailbox and authentication |
| 6 | Test the website's supported mailbox operations | Request IDs, safe retries and expected results |
| 7 | Enable production after service acceptance | Website can operate the mailbox without an open GSW or AI chat |
| 8 | Monitor/manage the service in the admin portal | Rotate/revoke keys, pause, review usage and diagnose failures |

The website backend keeps the key. Browser code and public form submitters never receive it. The external application needs no separately registered GSW OAuth client for this key-based path. GSW's existing underlying mailbox authentication is an implementation responsibility, not a second developer integration product to assemble.

## Administration changes

Connections belong to the workspace, not permanently to the administrator who first clicked Create. Existing authorized owners/admins should manage the same connections. Keep creator identity in audit history. Replacing an admin should not, by itself, disconnect a valid workspace mailbox service.

Runtime access no longer depends on the original authorizer retaining membership. Current workspace admins can manage the connection. The active mailbox-owner identity and existing stored/refreshable mailbox authorization are still required for engine operations; the service check surfaces reconnection needs. An independent mailbox service-credential lifecycle remains future work.

## Capabilities and status

| Area | Target | Current API branch |
|---|---|---|
| Authentication | One full-mailbox key | Full-mailbox key |
| Management | API keys and service controls in admin portal | API panel with key/connection controls, documentation and service/activity checks |
| Mail sending | Normal supported mailbox recipients, replies, cc/bcc, templates and attachments | Direct email to normal recipients plus supported sending/draft/template/attachment registry operations |
| Mail reading/organization | Inbox, threads, search, drafts, attachment retrieval and message actions | Available registered functions through /operations; discover schemas with /capabilities |
| Other mailbox services | Calendars, contacts, files, campaigns, tasks/AI/automation and preferences | Available registered functions through /operations; discover schemas with /capabilities |
| Connection/status | Health, activity, usage and operation status | Connection and email status plus admin readiness/activity summaries |
| Events | Signed customer webhooks | Not implemented |
| Admin operations through key | Never allowed | Not exposed |

Pilot recipient/scope columns remain for storage compatibility, but keys now grant full mailbox access and those values no longer restrict execution. Existing pilot keys receive this access model as well. Test mode stays an operational tool; it is not a reduced-feature permission tier.

## Safe Place Ministries

The GSW admin creates the ministry mailbox connection and server key. Safe Place stores it on its backend and uses the same API for inquiry mail, visitor acknowledgments, subscriber records, calendars and files as those routes become available. Its own admin portal remains responsible for website content and business records.

First live acceptance: save an inquiry and local outbox entry, notify the ministry, confirm real delivery and display status. Dynamic visitor acknowledgments can use the same mailbox API without a recipient allowlist; ordinary sender, suppression and sending rules still apply.

## Operational basics

Keys grant substantial mailbox authority. Treat them as secrets and rotate/revoke them through admin management. Mailbox isolation, sender validity, message validation, suppression/consent, duplicate prevention and resource/capacity limits remain shared product behavior. Customers do not configure a new permission tier for each action.

Revocation prevents future authorization; it cannot recall an already-submitted message. Changing administrators should preserve workspace-owned connections; disabling the mailbox, pausing the service or revoking its authority should stop access. Document and test those cases as the lifecycle is implemented.

For exact current requests, status semantics, deployment steps and known restrictions, use [email API pilot](email-api-pilot.md). For the implementation order, use [mailbox API service plan](../GSW_MAIL_API_SERVICE_PLAN.md).


## Developer site and diagnostics

Public docs: https://mail-docs.guidedstepswellness.com (fallback: https://mail.guidedstepswellness.com/docs). The documentation includes customer onboarding, server-side authentication examples and the current operation schemas. API requests continue to use the mail host. `GET /integrations/v1` now returns connection guidance rather than a route-not-found error.

Control Center → API offers live mailbox and AI diagnostics using the existing mailbox authorization. This checks a mailbox read, the selected AI provider and Kimi without creating an external key or sending email. These checks do not establish bearer-key acceptance or recipient delivery.


Mailbox authorization uses an encrypted, owner-bound first-party credential vault. Existing authorizations created before this correction stored hashes only and require one mailbox-owner renewal at `/settings/mcp-mailbox-recovery`. An admin login cannot replace the mailbox owner session. After renewal, repeat the admin live checks; bearer-key and delivery acceptance remain separate checks.
