# GSW Mail Connected Apps — OAuth Capabilities & User-Controlled Sharing

**Status:** Draft / living design document  
**Last revised:** 2026-10-14  
**Scope:** GSW Mail web, mobile, API, OAuth provider, AI inference, and third-party integrations  
**Implementation status:** Proposal only. No permissions, endpoints, tokens, or user interfaces described below are implemented by this document.

## 1. Product vision

GSW Mail should serve as an identity provider **and** a user-controlled capability platform. A user can connect another application to GSW Mail and explicitly decide which GSW resources that application can access and which actions it can request.

The user should understand **before granting access**:
- The requesting application's verified name and publisher.
- Which categories of GSW Mail information it can read or export.
- Which changes or outbound actions it can initiate.
- Which mailbox/account, calendar, contacts collection, files workspace, or AI resources are in scope.
- Whether access continues while the user is away (offline access), and how to revoke it.
- Whether AI requests consume their GSW Mail model allocation, credits, or usage limits.

**Core principle:** GSW login alone does not grant access to mail, contacts, calendars, files, chats, or AI inference. All capabilities are opt-in and revocable.

## 2. Six broad user-facing permission categories

Present six clear, independent checkboxes or cards in the initial consent flow and in **Settings → Connected Apps → [App] → Permissions**. Each broad category is a user-facing grouping, **not** a single unrestricted OAuth scope. Within a category, users should be able to distinguish **View/Read** from **Create/Edit/Act**, with additional confirmations for consequential operations.

| Category | Read/share examples | Action examples | Important controls |
| --- | --- | --- | --- |
| **Email actions** | Read mailboxes, messages, threads, labels, attachments, drafts, and delivery status | Draft, reply, forward, move, label, archive, trash, schedule, and send email; manage campaigns where explicitly permitted | Select mailboxes; sending and bulk outreach need explicit authorization and action confirmation |
| **Contacts** | Read contact names, addresses, organizations, groups, and tags | Create, update, organize, import, and delete contacts; select recipients | Allow read-only; separately authorize writes, imports, exports, and bulk changes |
| **Calendar** | Read calendars, availability, events, and attendees | Create, edit, cancel events, send invitations, RSVP, and manage reminders | Select calendars; distinguish free/busy from event details; confirm invitations and cancellations |
| **Files** | List, search, preview, download, and retrieve selected files and folders | Upload, create, edit, organize, move, share, and delete files; attach files to mail | Select workspaces/folders; separately authorize external sharing and deletion |
| **AI Chats** | List or read specifically permitted conversations, messages, and chat-generated assets | Create conversations, add messages, resume tasks, and manage chat artifacts | Default private; distinguish reading existing chat history from creating new conversations; do not silently expose private chat history |
| **AI functionality** | View allowed model names and capability metadata | Use the **user's selected GSW Mail AI model** to power the connected app for text, tool reasoning, image generation/editing, and other supported modalities | Respect model selection, provider availability, quotas, rate limits, billing, content policies, and per-tool permissions; AI inference access alone grants **no** mail/contact/calendar/file access |

**Coverage note:** Other capabilities (scheduled work, research/browser automation, templates, campaigns, workspace settings, and administration) need an explicit mapping into these categories or a separate advanced permission group. Do **not** silently bundle domain administration, account management, mass campaigns, browser writes, or other privileged operations into a broad checkbox.

### Suggested default consent UI

- Identity: “Sign in as [account]” — identity permissions shown separately from the six capability groups.
- Six **unchecked** capability cards, each with a short plain-language description and expandable details.
- Read-only vs. “Allow changes” controls for each applicable category.
- Context selectors: which mailbox, calendars, contact lists, file workspaces/folders, and chat conversations.
- AI model display: “Use my selected model: [model name]”, with clear cost and usage disclosures.
- Prominent **Allow selected access** and **Cancel** actions; no prechecked high-risk permissions.
- The application may request a subset of permissions. The user can approve a smaller subset; the connected application must handle denied scopes gracefully.
- Provide a plain-language preview: “This app can read [X], create [Y], and cannot [Z].”

## 3. Two independent authorization layers

1. **OAuth delegated scopes:** Which capabilities a specific external OAuth client may access on behalf of a particular GSW user. Enforce on **every** API request, not only on the consent page.
2. **GSW internal permissions and confirmations:** Which actions that GSW user/account is authorized to perform, including AI agent scopes and human confirmation policies.

Effective permission is the **intersection** of (a) OAuth grant, (b) the user's current GSW permissions, (c) resource ownership/membership, (d) organization policy, and (e) action-specific confirmation requirements. A broad OAuth grant cannot bypass internal checks.

Existing internal AI scopes in `apps/api/src/ai/permissions/types.ts` (such as `mail.read`, `mail.send`, `calendar.write`, `files.write`, and `images.generate`) are useful as a mapping reference. They must **not** automatically become publicly requestable OAuth scopes without review and resource-level enforcement.

## 4. Proposed OAuth scope model (illustrative; subject to revision)

Retain standards-based identity scopes: `openid`, `profile`, `email`, `offline_access`.

Define a versioned delegated-scope namespace, for example:

| Group | Candidate scopes |
| --- | --- |
| Email | `gsw.mail.read`, `gsw.mail.draft`, `gsw.mail.manage`, `gsw.mail.send`, `gsw.mail.bulk` |
| Contacts | `gsw.contacts.read`, `gsw.contacts.write` |
| Calendar | `gsw.calendar.freebusy`, `gsw.calendar.read`, `gsw.calendar.write`, `gsw.calendar.invite` |
| Files | `gsw.files.read`, `gsw.files.write`, `gsw.files.share`, `gsw.files.delete` |
| AI Chats | `gsw.chats.create`, `gsw.chats.read`, `gsw.chats.write` |
| AI functionality | `gsw.ai.infer`, `gsw.ai.images`, `gsw.ai.video`, `gsw.ai.tools` |

These names are **proposals**, not an existing API contract. Public scopes should remain fine-grained and stable even if the Settings UI uses six broad groupings. Tool execution through AI requires **both** the relevant AI capability and the resource/action scope (e.g., `gsw.ai.tools` + `gsw.mail.send`).

## 5. Connected Apps settings: user control before and after authorization

Create **Settings → Connected Apps** on web and mobile, with:

- A list of connected applications, publisher, connection date, last-used date, and status.
- For each app, six permission groups with explicit read/action switches and selected resource boundaries.
- A preview of exactly what is shared and what remains private.
- Ability to reduce or revoke access at any time; expanding access requires fresh consent.
- One-click **Disconnect app**, revoking grants and refresh tokens; short-lived access tokens must also be rejected after revocation using server-side grant status/version checks.
- Activity history: which app accessed which resource category, requested which action, and whether it succeeded or was denied (privacy-minimized, without storing message bodies).
- Optional notifications for newly connected apps, privilege expansions, and sensitive actions.
- Controls for offline/background access and AI model usage limits per app.

**Consent is not permanent permission.** Every API call must consult the current effective grant, including after the user changes Settings.

## 6. AI model delegation to connected applications

A connected app may call a GSW-hosted inference endpoint **as the authorized GSW user**, using the model that user selected in GSW Mail Settings.

Proposed behavior:
1. The connected app requests `gsw.ai.infer` (and optional modality scopes).
2. GSW displays the selected model/provider, availability, quotas, and charging rules.
3. The app submits a prompt through a delegated, scoped GSW AI API. GSW resolves the **current** selected model server-side, rather than trusting a client-provided provider ID.
4. GSW applies user/account limits, per-client rate limits, usage attribution, model/tool safety policies, and provider routing/fallback policy.
5. Inference results return to the connected app. No existing GSW AI Chats history is exposed unless separately authorized.
6. If the user changes the model, subsequent requests follow the new selection subject to compatibility; unsupported modalities return a clear capability error.

**Do not** expose Modal URLs, provider API keys, model credentials, or privileged internal tool tokens to connected applications. AI model access is not permission to use arbitrary GSW tools.

Open design decisions: which plans may delegate inference; whether the user or app pays; per-app budgets; streaming and async job support; model fallback visibility; and whether outputs are saved to GSW AI Chats by default (recommend **no**).

## 7. Security and consent rules

- OAuth 2.1-style authorization-code flow with PKCE, registered exact redirect URIs, client validation, state/nonce as applicable, and short-lived audience-bound access tokens.
- Explicit resource-server audience and server-side scope checks on each endpoint.
- Prefer authorization details/resource selectors (or server-side grant constraints) for mailbox, calendar, folder, and conversation selection; do not encode arbitrary resource IDs into unrestricted scopes.
- Deny by default. Existing identity-only OAuth clients retain their current identity behavior and receive **no** new permissions automatically.
- Restrict high-risk scopes to vetted/verified clients where appropriate; separate send, delete, share, bulk actions, admin, and domain management from ordinary read permissions.
- Preserve existing per-action human approvals for sending mail, invitations, external file sharing, bulk actions, and irreversible operations. An OAuth consent checkbox is **not** blanket approval for every future consequential action.
- Never accept an app-supplied user ID, account ID, or selected model as proof of authority.
- Use bounded rate limits, abuse detection, idempotency keys, auditable action outcomes, and safe retry semantics.
- Protect refresh tokens; rotate/revoke them and do not return them to browser JavaScript unnecessarily.
- Provide granular revocation and clear data retention/export policies. Revoking future access does not automatically erase data previously copied by a connected app; disclose this.
- Separate delegated API permissions from privileged GSW administration, infrastructure management, and internal credentials.

## 8. Current codebase baseline (reviewed 2026-10-14)

- `apps/web/src/pages/OAuthConsentPage.tsx` currently describes only `openid`, `profile`, `email`, and `offline_access`; it validates requested scopes against that limited set.
- `apps/api/src/auth/ensureWebOAuthTestClient.ts` registers an identity-only test client with `openid profile email`, PKCE, and consent.
- `apps/api/src/ai/permissions/types.ts` defines a much broader internal AI permission catalog and confirmation policies.
- The current OAuth identity consent UI is **not** a delegated capability-management UI, and the internal AI scopes are **not** evidence that third-party delegated APIs are already authorized.

## 9. Proposed implementation phases

### Phase A — Specification and mapping
- Inventory all externally useful GSW endpoints/actions, their existing authentication checks, data owners, and side effects.
- Finalize the six categories, granular scope registry, high-risk exceptions, and resource selectors.
- Decide how per-app AI inference usage is billed and limited.
- Write threat model and authorization matrix; define backward compatibility.

### Phase B — Server-side delegated grants
- Persist user + OAuth client + scope + resource constraints + expiration + revocation/version.
- Build server-side delegated authorization middleware; verify audience, scopes, resource ownership, and current user permissions on every call.
- Implement token/grant revocation and audit logging; maintain identity-only compatibility.
- Add contract tests for denied, revoked, cross-user, cross-mailbox, and privilege-escalation cases.

### Phase C — Consent and Settings
- Build six-card OAuth consent with granular controls and resource selection.
- Add Settings → Connected Apps on web and mobile, including edits, revoke/disconnect, and activity history.
- Ensure permissions can be reduced immediately and expanded only through re-consent.

### Phase D — Delegated resource APIs
- Expose carefully reviewed mail, contacts, calendar, files, and AI Chat operations.
- Enforce action confirmations, safe retries/idempotency, limits, and per-resource constraints.
- Avoid treating existing first-party session routes as third-party APIs by default.

### Phase E — Delegated AI inference
- Add scoped AI inference API, server-side model selection, quota/usage attribution, streaming/async support, and optional modality scopes.
- Confirm no implicit access to chat history or tools; require separate grants for tools.
- Test model switching, provider outages, quotas, and abuse controls.

### Phase F — Pilot and rollout
- Start with a first-party or trusted pilot app; review security, privacy, and user comprehension.
- Roll out read-only scopes before sensitive writes.
- Add integration docs, SDK examples, and revocation/consent regression tests.

## 10. Open questions / future revisions

1. Should the six groups be checkboxes only, or should each open a detailed read/write/action selection? **Recommendation:** six cards with granular expansion.
2. Can a connected app access multiple GSW mailboxes, or only explicitly selected ones?
3. Should AI Chats be shared conversation-by-conversation, workspace-by-workspace, or both?
4. Should AI model delegation use the user's global model choice, or allow a per-app override?
5. Who pays for AI usage initiated by another app? Can users set monthly caps?
6. Which actions require interactive confirmation every time, even after OAuth approval?
7. How should recurring automations and long-running AI jobs behave when access is revoked mid-run?
8. Should campaigns, scheduled tasks, browser automation, and workspace administration become separate advanced groups?
9. Which third-party apps may request write/send permissions, and what client verification is required?
10. What export/deletion assurances must connected apps provide for data previously retrieved?

## 11. Acceptance criteria for future implementation

- Signing in via GSW OAuth without capability grants never allows resource access.
- A user can grant only Contacts read access while denying all other categories.
- A connected app cannot read an unselected mailbox, calendar, file workspace, or chat.
- Revocation in Settings blocks future API calls, including with an otherwise unexpired token.
- AI inference uses the selected GSW model and never implicitly grants chat history or tool access.
- Sending mail, inviting attendees, externally sharing files, and other consequential actions respect explicit delegated permissions **and** GSW confirmation policy.
- Web and mobile display consistent connected-app permissions and audit history.
- Tests cover cross-user access, changed permissions, revoked tokens, duplicate writes, and missing/invalid scopes.

---

**Document maintenance:** Revise this specification as product decisions evolve. No schema migration, OAuth scope registration, or production behavior should be changed merely because this document is committed.
