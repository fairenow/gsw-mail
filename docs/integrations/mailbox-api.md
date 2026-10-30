# Mailbox API: customer setup and admin management

Approved direction, October 30, 2026. Full mailbox coverage is not implemented yet. See [the current email pilot contract](email-api-pilot.md) for routes that exist on the API branch.

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

The current Control Center **Email Delivery** panel already creates pilot connections/keys and supports pause/resume and revocation. The consolidated API area, in-portal documentation links, health and usage views remain to be built.

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

The pilot currently rechecks the original authorizer's active membership. Removing that dependency and implementing durable workspace-owned service authority are explicit code changes still required. Existing mailbox credentials also require operational health/reconnect handling. This guide does not claim those changes have shipped.

## Capabilities and status

| Area | Target | Current API branch |
|---|---|---|
| Authentication | One full-mailbox key | Narrow connection/email scopes |
| Management | API keys and service controls in admin portal | Connection/key creation, listing, revocation, pause/resume in Email Delivery |
| Mail sending | Normal supported mailbox recipients, replies, cc/bcc, templates and attachments | Transactional text/optional HTML to exact approved recipients |
| Mail reading/organization | Inbox, threads, search, drafts, attachment retrieval and message actions | Not exposed by the pilot |
| Other mailbox services | Calendars, contacts, files, campaigns, tasks/AI/automation and preferences | Not exposed by the pilot |
| Connection/status | Health, activity, usage and operation status | Connection inspection and email status polling |
| Events | Signed customer webhooks | Not implemented |
| Admin operations through key | Never allowed | Not exposed |

The pilot recipient allowlist and scope fields are temporary restrictions to replace, not permission settings the customer must learn for the full-mailbox service. Until code changes, actual requests remain subject to them. Test mode stays an operational tool; it is not a reduced-feature permission tier.

## Safe Place Ministries

The GSW admin creates the ministry mailbox connection and server key. Safe Place stores it on its backend and uses the same API for inquiry mail, visitor acknowledgments, subscriber records, calendars and files as those routes become available. Its own admin portal remains responsible for website content and business records.

First live acceptance: save an inquiry and local outbox entry, notify the ministry, confirm real delivery and display status. Dynamic visitor acknowledgments cannot work through the current pilot unless their recipients are explicitly allowed; removing that pilot restriction is part of the approved foundation work.

## Operational basics

Keys grant substantial mailbox authority. Treat them as secrets and rotate/revoke them through admin management. Mailbox isolation, sender validity, message validation, suppression/consent, duplicate prevention and resource/capacity limits remain shared product behavior. Customers do not configure a new permission tier for each action.

Revocation prevents future authorization; it cannot recall an already-submitted message. Changing administrators should preserve workspace-owned connections; disabling the mailbox, pausing the service or revoking its authority should stop access. Document and test those cases as the lifecycle is implemented.

For exact current requests, status semantics, deployment steps and known restrictions, use [email API pilot](email-api-pilot.md). For the implementation order, use [mailbox API service plan](../GSW_MAIL_API_SERVICE_PLAN.md).
