# GSW Mail AI Agent Readiness Audit

**Repository audited:** `fairenow/gsw-mail`  
**Reference:** current `main` branch at the time of this audit  
**Purpose:** determine what must be normalized, added, or hardened before implementing the AI Agent plan.

This audit should be read with `docs/AI_AGENT_IMPLEMENTATION_PLAN.md`.

---

# Implementation progress — 2026-10-07

The first agent-readiness slice is now underway.

Completed/in progress:

- shared `MailService` covers search, message read, thread read, seen state, and archive for routes that have been migrated;
- provider-neutral `AgentToolDefinition` / `AgentExecutionContext` / `AgentToolResult` contracts exist;
- a read-only tool registry exposes `mail.search`, `mail.read`, and `mail.read_thread`;
- GSW Chat now supplies explicit selected-account context and can use those tools through the Hetzner inference adapter;
- tool execution still relies on current GSW account authorization and exposes no write/action capability.

Progress since the initial audit:

- persistent conversation/message/run state is now implemented;
- AI permission-grant and confirmation persistence is now implemented;
- the dedicated tool-call/result action ledger is now implemented with sanitized arguments/results;
- browser sessions can restore the current conversation per selected mailbox;
- read-only tool executions are recorded without storing full mailbox bodies in the ledger.

Progress since the previous checkpoint:

- executor-wide idempotency reservations now exist for all future non-read tool executions;
- the central agent executor now gates tools on AI scopes before execution;
- GSW Chat now renders in-chat permission and confirmation cards and can resume a paused mailbox request after permission is granted;
- first-use mailbox reading now requires the explicit `mail.read` AI grant in addition to the user's ordinary mailbox authorization.

Progress since the previous checkpoint:

- live server-to-browser execution events are now implemented for chat runs;
- GSW Chat visibly reports reasoning/tool phases while the backend is still working;
- permission-resumed requests use the same streaming execution path;
- the existing non-streaming chat endpoints remain available as compatibility fallbacks.

Still blocking write access:

- safe reversible-write tools and their domain services;
- confirmation-resume binding for exact mutation payloads;
- broader domain-service normalization;
- evaluation coverage.

---

# Executive Summary

GSW Mail is already a strong foundation for an agentic communication product.

The current application has working primitives for most ordinary mail operations, scheduled and recurring sends, a virtual Outbox, contacts, signatures, calendar event CRUD, mailbox roles, domains, aliases, administrative health/status views, and an existing audit-event system.

The primary readiness problem is **not lack of mail functionality**.

The primary gaps are:

1. a shared **GSW Domain Services** layer used by both the UI and agent;
2. an **agent tool registry** over those services;
3. agent-specific **permission scopes and confirmation state**;
4. persistent **conversation / execution / tool-call state**;
5. a reliable **agent audit ledger**;
6. **durable asset storage** for generated documents/images;
7. several missing semantic primitives such as calendar availability, invitation response, recurring-series pause/resume/reschedule, and first-class reply/forward helpers;
8. user-editable **template** infrastructure;
9. campaign, research, automation, and briefing subsystems;
10. an agent-specific **evaluation suite** before external actions are enabled.

The recommended implementation order remains:

```text
Domain-service normalization
        ↓
Capability + permission contracts
        ↓
Idempotency + audit hardening
        ↓
Account/context state
        ↓
R2 asset service
        ↓
Agent evaluation harness
        ↓
Tool registry
        ↓
Conversation persistence
        ↓
Modal provider adapter
        ↓
Execution loop + SSE
        ↓
Assistant UI
        ↓
Read-only rollout
        ↓
Reversible writes
        ↓
External actions
```

---

# Status Definitions

| Status | Meaning |
|---|---|
| **Ready** | The underlying application capability exists and is sufficiently complete to wrap as an agent tool. |
| **Needs wrapper** | The required behavior exists, but the agent needs a semantic domain-service wrapper so it does not manipulate lower-level details. |
| **Partial** | Some required behavior exists, but important semantics, safety, or lifecycle handling are missing. |
| **Missing** | The application does not currently provide the capability. |
| **Defer** | Intentionally keep outside the initial agent release. |

---

# 1. Mail Capability Matrix

| Proposed tool | Status | Existing foundation | Gap / action |
|---|---|---|---|
| `mail.search` | **Ready** | `/mail/search`, `MailEngine.search` | Wrap in `MailService.search`. |
| `mail.read` | **Ready** | full message route + `MailEngine.getMessage` | Wrap and normalize sanitized body/attachment metadata. |
| `mail.read_thread` | **Ready** | `/mail/threads/:threadId`, `MailEngine.getThread` | Wrap in domain service. |
| `mail.summarize` | **Needs wrapper** | read primitives exist | Summary itself belongs to model; tool should retrieve bounded context, not create a second summary API. |
| `mail.compose` | **Ready** | model can prepare content without persistence | Keep model-side until user requests a draft/send. |
| `mail.create_draft` | **Ready** | `POST /mail/drafts` | Move core logic into `MailService.createDraft`. |
| `mail.update_draft` | **Ready** | `PATCH /mail/drafts/:id` | Domain wrapper. |
| `mail.reply` | **Needs wrapper** | threading fields, mode, draft/send infrastructure exist | Backend should resolve recipients, `In-Reply-To`, `References`, subject, quote/signature behavior from source message. |
| `mail.reply_all` | **Needs wrapper** | `replyAll` mode exists | Add deterministic recipient resolution and sender exclusion. |
| `mail.forward` | **Partial** | compose/send primitives exist | Add first-class source-message forward helper that carries original body/attachments safely. |
| `mail.send` | **Ready** | `submitSend`, queue, undo window | Preserve current queued-send architecture. Require agent confirmation policy. |
| `mail.schedule` | **Ready** | draft scheduling + `scheduledSends` | Wrap semantic schedule action. |
| `mail.schedule_recurring` | **Ready** | daily/weekdays/weekly/monthly recurrence | Wrap and expose recurrence schema cleanly. |
| `mail.reschedule` | **Missing** | scheduled time stored in `scheduledSends` | Add safe reschedule service for pending scheduled sends. |
| `mail.pause_recurring` | **Missing** | recurrence metadata exists | Add series status / pause state. |
| `mail.resume_recurring` | **Missing** | recurrence metadata exists | Add series status / resume semantics. |
| `mail.cancel_scheduled` | **Partial** | queued/preparing send cancellation exists | Formalize scheduled-message cancellation and recurring-series behavior. |
| `mail.archive` | **Ready** | single and bulk move support | Wrapper only. |
| `mail.move` | **Ready** | engine move route | Wrapper with mailbox validation. |
| `mail.trash` | **Ready** | single and bulk | Wrapper only. |
| `mail.restore` | **Ready** | bulk restore → Inbox | Add single semantic wrapper. |
| `mail.destroy` | **Ready** | bulk destroy + empty Trash | Treat as destructive/high-impact. |
| `mail.mark_read` | **Ready** | single/bulk seen | Wrapper only. |
| `mail.mark_unread` | **Ready** | single/bulk unseen | Wrapper only. |
| `mail.flag` | **Ready** | single/bulk flag | Wrapper only. |
| `mail.unflag` | **Ready** | single/bulk unflag | Wrapper only. |
| `mail.attach_file` | **Partial** | draft attachment APIs accept base64 | Replace agent-facing payloads with durable asset references. |
| `mail.remove_attachment` | **Ready** | draft attachment delete by position | Wrap using stable asset/attachment identity rather than model-visible array position where possible. |
| `mail.bulk_archive` | **Ready** | bulk API, max 100 IDs | Add query-backed bulk path for large result sets. |
| `mail.bulk_move` | **Partial** | bulk API handles fixed actions, not arbitrary move target | Add server-side query + destination abstraction. |
| `mail.bulk_trash` | **Ready** | bulk action | Query-backed execution needed for large sets. |
| `mail.bulk_mark_read` | **Ready** | bulk action | Query-backed execution needed for large sets. |
| `mail.bulk_label` | **Missing** | no first-class custom mail-label system in current MailEngine contract | Decide whether GSW needs labels beyond folders/flags before implementing. |

## Mail observations

### Strong existing foundations

- outbound sending is queued rather than synchronous;
- `clientRequestId` already gives send/schedule idempotency;
- scheduled and recurring email already has a dedicated data model;
- scheduled content edits are synchronized back to the outbound row;
- Outbox is already represented as a virtual product concept;
- account roles already distinguish `read`, `send`, and `manage`;
- suppressions and send-rate checks already exist.

### Required mail hardening

1. Extract route logic into `MailService` / `OutboxService`.
2. Add first-class reply/reply-all/forward helpers.
3. Add recurring-series state and reschedule/pause/resume.
4. Add query-backed bulk operations so the model never transports thousands of message IDs.
5. Apply idempotency beyond send/schedule where retries could duplicate writes.
6. Create a uniform mutation audit path.

---

# 2. Calendar Capability Matrix

| Proposed tool | Status | Existing foundation | Gap / action |
|---|---|---|---|
| `calendar.list` | **Ready** | list calendars | Wrapper only. |
| `calendar.search` | **Partial** | list events by date range | Add normalized search/filter service. |
| `calendar.read` | **Partial** | events can be listed | Add direct event retrieval or reliable event lookup. |
| `calendar.availability` | **Missing** | no free/busy primitive in `MailEngine` | Add engine/domain capability. |
| `calendar.create` | **Ready** | create event | Wrap + idempotency key. |
| `calendar.update` | **Ready** | update event | Wrap + partial update semantics if desired. |
| `calendar.cancel` | **Ready** | destroy event | High-impact confirmation when attendees exist. |
| `calendar.respond` | **Missing** | no invitation response primitive | Add accepted/declined/tentative action. |
| `calendar.add_attendee` | **Needs wrapper** | full attendee list accepted in event update | Domain service should preserve existing attendees and add one safely. |
| `calendar.remove_attendee` | **Needs wrapper** | full attendee list update | Domain service should remove one safely. |
| `calendar.create_meeting_from_email` | **Needs wrapper** | mail + calendar capabilities exist | Composite agent workflow. |
| recurring event management | **Missing** | event input has no recurrence model | Add only when product needs it. |

## Calendar authorization note

Calendar access should be normalized through explicit account permission checks inside the future `CalendarService`. The current route helper resolves an account then obtains an engine context; the agent layer should not depend on implicit authorization behavior.

---

# 3. Contacts and Memory Capability Matrix

| Proposed tool | Status | Existing foundation | Gap / action |
|---|---|---|---|
| `contacts.search` | **Ready** | paginated ranked contact search | Wrapper only. |
| `contacts.read` | **Ready** | contact detail | Wrapper only. |
| `contacts.create` | **Ready** | contact create | Add agent idempotency. |
| `contacts.update` | **Ready** | contact update | Add agent audit/idempotency. |
| `contacts.merge` | **Partial** | merge behavior exists inside CSV import path | Extract reusable merge service with identity/conflict safeguards. |
| `contacts.tag` | **Ready** | tags are persisted through updates | Semantic wrapper. |
| `contacts.import` | **Ready** | CSV-like mapped import flow | Agent use should require file asset references and bounded batch policy. |
| `contacts.recent` | **Partial** | `lastContactedAt`, `timesEmailed` exist | Add dedicated query/service. |
| `contacts.relationship_history` | **Partial** | basic sent-mail engagement metadata exists | Build event/history aggregation; later add RAG/contact memory. |

## Contact identity requirement

Before writing contact memory, build deterministic identity resolution:

- normalized email as strongest identity;
- explicit ambiguity state for same-name contacts;
- source/provenance on inferred facts;
- no silent merge based only on display name;
- confidence threshold before an agent acts on a name.

A mistaken contact merge can contaminate future RAG and should therefore be treated as a high-value evaluation scenario.

---

# 4. Identity, Sender, and Profile Matrix

| Proposed tool | Status | Existing foundation | Gap / action |
|---|---|---|---|
| `identity.get_profile` | **Partial** | account context + settings + mailbox display names | Create unified profile DTO/service. |
| `identity.update_profile` | **Partial** | user settings and mailbox display name updates exist | Decide distinction between user profile vs mailbox identity. |
| `identity.set_profile_image` | **Partial** | `profileImageUrl` setting exists | Needs durable AssetService/R2 upload and signed/private URL policy. |
| `sender.list` | **Ready** | accessible accounts | Wrapper only. |
| `sender.select` | **Missing** | UI can select account | Agent conversation must persist explicit `activeAccountId`. |
| `sender.create_alias` | **Ready** | alias creation | Admin role + confirmation. |
| `sender.delete_alias` | **Ready** | alias delete | Admin role + confirmation. |

---

# 5. Signature Matrix

| Proposed tool | Status | Existing foundation | Gap / action |
|---|---|---|---|
| `signature.list` | **Partial** | one user signature returned in settings | Multiple signatures not supported. |
| `signature.create` | **Partial** | upsert one user signature | Add explicit create only if multiple-signature model is desired. |
| `signature.update` | **Ready** | current user signature upsert | Wrap current behavior. |
| `signature.delete` | **Missing** | no delete route | Add clear/delete behavior. |
| `signature.set_default` | **Partial** | only one user-wide signature | Needs multi-signature or account assignment model. |
| `signature.assign_to_identity` | **Missing** | signature is user-wide | Add account/identity relationship if desired. |

### Decision required

Before agent implementation, decide whether signatures remain:

1. one signature per user; or
2. multiple signatures, assignable per mailbox/identity.

The requested agent behavior strongly favors option 2.

---

# 6. Template Matrix

| Proposed tool | Status | Existing foundation | Gap / action |
|---|---|---|---|
| `templates.list` | **Ready** | static template catalog route | Current templates are code-defined. |
| `templates.read` | **Needs wrapper** | catalog data exists | Semantic lookup. |
| `templates.create` | **Missing** | no user template persistence | Add DB model + service. |
| `templates.update` | **Missing** | no user template persistence | Add service. |
| `templates.delete` | **Missing** | no user template persistence | Add service. |
| `templates.apply` | **Partial** | send flow supports template key | Generalize to user templates. |
| `templates.generate` | **Missing** | model can generate content but no persistence | Depends on template CRUD. |
| `templates.duplicate` | **Missing** | no user template model | Add after CRUD. |

**Finding:** the current template system is primarily a branded rendering catalog, not yet a user-managed reusable-template product.

---

# 7. Asset / File Readiness

| Capability | Status | Existing foundation | Gap / action |
|---|---|---|---|
| read inbound attachment | **Ready** | engine attachment retrieval | Wrap with asset/file metadata when useful. |
| attach bytes to draft | **Ready** | draft attachment store | Current storage mechanism is not suitable for general generated assets. |
| `files.list` | **Missing** | no general asset library | Build AssetService. |
| `files.read` | **Missing** | only mail attachments | Build AssetService. |
| `files.save` | **Missing** | no general object store abstraction | Create R2-backed storage. |
| `files.rename` | **Missing** | no asset model | Add after AssetService. |
| `files.delete` | **Missing** | no asset model | Add after AssetService. |
| `files.generate_document` | **Missing** | no generation service | Agent later calls document generator then saves asset. |
| `files.generate_pdf` | **Missing** | no generation service | Same. |
| `files.generate_spreadsheet` | **Missing** | no generation service | Same. |

## Critical storage finding

Current draft attachments are persisted as **base64 in Postgres** in `draft_attachment_payloads`, with the table created lazily at runtime.

That implementation is useful for the current composer but should **not** become the agent's general file architecture.

Before generated-file support:

1. create a dedicated R2 bucket;
2. create `assets` metadata table;
3. implement `AssetService`;
4. use private object keys;
5. issue signed/authorized download URLs;
6. enforce MIME/size limits;
7. attach files using asset references rather than base64 in model/tool calls;
8. define retention/deletion rules;
9. add malware/file-safety policy appropriate to supported uploads.

---

# 8. Image Capability Matrix

| Proposed tool | Status | Gap |
|---|---|---|
| `images.generate` | **Missing** | Add provider/generation adapter. |
| `images.edit` | **Missing** | Add later. |
| `images.save` | **Missing** | Depends on AssetService/R2. |
| `images.set_profile_image` | **Missing/Partial** | URL setting exists; durable image asset flow does not. |
| `images.attach_to_email` | **Partial** | draft attachments exist; needs asset-reference bridge. |

---

# 9. Inbox Cleanup Matrix

| Proposed tool | Status | Existing foundation | Gap |
|---|---|---|---|
| `inbox.classify` | **Needs wrapper** | model + search/read can classify | No special backend required initially. |
| `inbox.bulk_archive` | **Ready/Partial** | up to 100 IDs per call | Add query-backed large-set execution. |
| `inbox.bulk_move` | **Partial** | fixed bulk actions | Add arbitrary mailbox destination/query-backed execution. |
| `inbox.bulk_delete` | **Ready** | trash/destroy available | Confirmation policy required for destroy. |
| `inbox.bulk_mark_read` | **Ready** | bulk route | Query-backed large-set execution. |
| `inbox.create_rule` | **Missing** | no rule engine | Future phase. |
| `inbox.apply_rule` | **Missing** | no rule engine | Future phase. |
| `inbox.clean` | **Needs wrapper** | composite search/classify/bulk flow | Agent workflow after query-backed bulk service exists. |
| unsubscribe automation | **Missing** | no list-unsubscribe tool/service | Future capability. |

---

# 10. Campaign Readiness

**Status: Missing as a native GSW product subsystem.**

The repository uses Resend as an outbound provider option, but it does not currently expose the Resend campaign/broadcast/contact-segment feature set as a GSW campaign domain.

Before enabling campaign tools, create a dedicated `CampaignService` and decide which data GSW owns versus what remains provider-owned.

Needed capabilities include:

```text
campaign.create
campaign.read
campaign.update
campaign.preview
campaign.schedule
campaign.launch
campaign.pause
campaign.cancel
campaign.duplicate
campaign.segment.*
campaign.contacts.*
campaign.metrics
```

### Hard requirement

Do not implement campaign sending by looping over `mail.send`.

Campaign execution must remain distinct from personal mail for:

- consent/unsubscribe;
- suppressions;
- limits;
- analytics;
- retries;
- provider semantics;
- approval policy.

---

# 11. Research Readiness

**Status: Missing.**

No native research service/tool registry exists in the current app.

Future `ResearchService` should own:

- web research requests;
- source/provenance references;
- company/person/domain entities;
- saved research artifacts;
- transfer into contact/campaign context.

Research output must never imply send permission.

---

# 12. Automation and Briefing Readiness

| Capability | Status | Gap |
|---|---|---|
| automation persistence | **Missing** | Add data model. |
| scheduler/condition evaluator | **Missing** | Add worker/scheduler. |
| automation pause/resume | **Missing** | Add lifecycle. |
| automation run history | **Missing** | Add audit/run table. |
| reminder engine | **Missing** | Can share scheduler. |
| daily briefings | **Missing** | Build after read tools + scheduler. |
| browser-independent execution | **Missing** | Required for background workflows. |

Modal should only be invoked when an automation run requires reasoning. Modal should not serve as the scheduler.

---

# 13. Workspace / Admin / Domain Matrix

## Read capabilities

| Proposed tool | Status | Existing foundation |
|---|---|---|
| `admin.control_center` | **Ready** | control-center aggregate route |
| `admin.health` | **Ready** | database/mail-engine/relay health |
| `admin.stats` | **Ready** | outbound/inbound operational stats |
| `admin.outbound_status` | **Ready** | latest outbound operations |
| `admin.audit` | **Ready** | organization audit list |
| `workspace.list_members` | **Ready** | returned by control center |
| `workspace.read_mailboxes` | **Ready** | control center |
| `workspace.read_mailbox_access` | **Ready** | memberships/access data |
| `domain.list` | **Ready** | domain admin route |
| `domain.read_dns` | **Ready** | expected/observed DNS state |
| `domain.verify` | **Ready** | verification route |
| `domain.diagnose` | **Needs wrapper** | DNS/provider state exists; provide semantic diagnosis |
| `alias.list` | **Ready** | aliases route |
| `mailbox_admin.read_quota` | **Ready** | account/control-center data |
| `mailbox_admin.read_setup_status` | **Ready** | account/control-center data |

## Administrative writes

| Proposed action | Status | Notes |
|---|---|---|
| add domain | **Ready** | provisions infrastructure; high impact |
| create mailbox | **Ready** | account route; high impact |
| update mailbox status/name/quota | **Ready** | account update route |
| grant mailbox delegate | **Ready** | account delegate infrastructure |
| revoke mailbox delegate | **Ready** | account delegate infrastructure |
| create alias | **Ready** | aliases route |
| delete alias | **Ready** | aliases route |
| remove domain | **Missing** | no safe product flow identified |
| invite workspace member | **Missing/Partial** | not exposed as a clean current admin domain action |
| change organization member role | **Missing/Partial** | requires explicit service if desired |
| suspend/restore member | **Missing/Partial** | requires explicit service if desired |
| mailbox credential reset/setup | **Defer** | keep specially protected; do not expose to autonomous agent initially |

### Admin policy

Agent scopes must never elevate product authorization.

Effective permission is:

```text
agent_granted_scope
INTERSECT
current GSW account/workspace role
INTERSECT
tool-specific safety policy
```

---

# 14. Permission Readiness Audit

## Existing authorization

The app already has:

- account roles: `owner`, `delegate`, `read_only`;
- account permissions: `read`, `send`, `manage`;
- organization roles: `owner`, `admin`, `member`;
- explicit helpers such as `requireAccountPermission` and `requireOrgPermission`.

This is a strong base.

## Missing agent authorization layer

Add:

```text
ai_permissions
ai_permission_grants
ai_confirmations
```

or equivalent structures.

Agent scopes should include at minimum:

```text
mail.read
mail.write
mail.send
mail.bulk_write
calendar.read
calendar.write
contacts.read
contacts.write
templates.read
templates.write
signatures.read
signatures.write
files.read
files.write
images.generate
campaign.read
campaign.write
campaign.send
research.use
automations.read
automations.write
settings.read
settings.write
workspace.read
workspace.admin
domain.read
domain.write
alias.read
alias.write
mailbox_admin.read
mailbox_admin.write
admin.health.read
admin.audit.read
```

## Permission UX requirement

When an unavailable scope is first needed, the chat should reveal the permission request in context.

Permission state must also be inspectable/revocable in Settings.

---

# 15. Confirmation Matrix

This is the recommended starting baseline.

| Action class | Examples | Default |
|---|---|---|
| read-only | search/read/summarize/status/metrics | no confirmation |
| local reversible write | draft, flag, mark read, create template | no confirmation |
| mailbox organization | archive/move/bulk mark-read | usually no confirmation; summarize large scope first |
| recoverable delete | move to Trash | confirm for broad/bulk operations |
| permanent delete | destroy/empty Trash | always confirm |
| external communication | send/reply/forward | confirm |
| schedule external mail | schedule/recurring schedule | confirm |
| cancel/reschedule pending mail | scheduled message change | confirm when it changes external intent/timing |
| calendar local-only block | personal event with no attendees | normally no confirmation |
| calendar with attendees | create/update/cancel/respond | confirm |
| contact edit | create/update/tag | generally no confirmation; confirm ambiguous merge |
| profile/signature/template | reversible settings writes | generally no confirmation |
| campaign preparation | research/draft/segment/preview | no confirmation |
| campaign launch | any bulk external send | always confirm |
| domain/mailbox/admin changes | domains, aliases, users, access | always confirm |
| credential/security changes | password/reset/auth setup | keep outside autonomous agent initially |

Any identity ambiguity, recipient ambiguity, account conflict, or conflicting user instruction overrides the table and requires clarification.

---

# 16. Idempotency Audit

## Strong today

Send and scheduled-send flows already support `clientRequestId` and replay existing results.

This should become the pattern for the rest of the agent.

## Needs expansion

Add explicit idempotency support to agent-exposed writes where repeated execution could create duplicates:

- create contact;
- create event;
- create template;
- create asset;
- create automation;
- create campaign;
- launch campaign;
- create domain/mailbox/alias;
- other composite workflows.

Recommended rule:

```text
conversation_id + tool_call_id = stable idempotency namespace
```

The tool executor should return an existing successful result when replaying a completed tool call.

---

# 17. Audit / Observability Readiness

## Existing system

`auditEvents` and `audit()` already provide:

- actor;
- organization;
- action;
- resource type/id;
- metadata;
- IP;
- user agent;
- timestamp.

Several admin/account/alias operations already write audit events.

## Agent gap

The current audit helper is deliberately **best-effort**: failures are logged and swallowed.

That is acceptable for some product audit telemetry, but insufficient as the authoritative agent action ledger.

Add dedicated agent execution records:

```text
ai_tool_calls
ai_tool_results
ai_confirmations
ai_action_events
```

For every agent mutation, preserve:

- conversation;
- run;
- user;
- account/workspace;
- tool name;
- sanitized normalized arguments;
- required scope;
- permission decision;
- confirmation decision;
- idempotency key;
- result/resource refs;
- provider/model;
- start/end timestamps;
- failure/retry state.

Do not store auth tokens or secrets.

---

# 18. Conversation / Context Readiness

**Status: Missing.**

Required persistence:

```text
ai_conversations
ai_messages
ai_runs
ai_tool_calls
ai_tool_results
ai_confirmations
```

Required conversation context:

```text
active_account_id
active_workspace_id
active_sender_identity
current_route
current_selected_resource
```

The assistant should receive current UI resource references, not the entire mailbox.

Account switching must be explicit and visible.

---

# 19. Domain-Service Readiness

This is the most important architectural precondition.

Today, many behaviors are implemented directly in Fastify route handlers plus lower-level helpers.

Before the agent calls them, extract/formalize shared services.

Recommended first set:

```text
MailService
OutboxService
CalendarService
ContactService
IdentityService
SignatureService
TemplateService
AssetService
WorkspaceService
DomainService
MailboxAdminService
AuditService
```

Later:

```text
CampaignService
ResearchService
AutomationService
BriefingService
```

## Rule

```text
React UI -> API route -> Domain Service
AI Tool Executor -------> Domain Service
```

Neither agent tools nor React route handlers should duplicate business rules.

---

# 20. Agent Evaluation Readiness

**Status: Missing.**

Create a test harness before enabling external actions.

Minimum categories:

### Tool choice

- find last message from a person;
- read a thread;
- draft but do not send;
- schedule instead of send-now;
- archive instead of delete.

### Account correctness

- work in selected account;
- explicitly switch account;
- refuse/clarify when sender identity is ambiguous;
- never silently cross mailbox boundaries.

### Contact identity

- two contacts with same first name;
- alias versus canonical email;
- duplicate contact with different organization;
- conflicting contact memory.

### Confirmation

- send requires approval;
- bulk campaign launch requires approval;
- permanent delete requires approval;
- invitation response requires approval;
- ambiguous destructive action clarifies first.

### Idempotency

- repeated send tool call sends once;
- repeated event creation creates once;
- network retry returns prior success.

### Multi-step agentic flows

- read → draft → approval → send;
- mail → calendar;
- mail → contact;
- thread → document → attachment → draft;
- research → campaign draft without sending.

### Failure handling

- provider timeout;
- JMAP error;
- scheduled send conflict;
- permission revoked mid-run;
- browser closed during workflow;
- partial success.

Target production invariants:

```text
wrong-account external actions: 0
unauthorized successful actions: 0
duplicate sends from retries: 0
confirmation bypasses: 0
silent ambiguous-recipient sends: 0
```

---

# 21. Phase 0 Implementation Gap List

## P0 — Blockers before agent write access

1. **Create GSW Domain Services layer**
   - extract mail, outbox, calendar, contact, identity, signature, admin/domain operations from route-specific orchestration.

2. **Create agent permission + confirmation model**
   - scope storage;
   - in-chat grants;
   - revocation;
   - confirmation records;
   - effective-role intersection.

3. **Create agent action ledger**
   - tool calls/results/confirmations;
   - reliable persistence;
   - sanitized audit metadata.

4. **Create conversation/run persistence**
   - active account/workspace;
   - messages;
   - tool state;
   - resumable workflow state.

5. **Create R2 AssetService**
   - dedicated bucket;
   - asset metadata table;
   - signed/private access;
   - attachment bridge;
   - replace agent-facing base64 payload flow.

6. **Expand idempotency**
   - normalized executor idempotency for all important writes.

7. **Build evaluation harness**
   - initially against deterministic/fake tool planner tests;
   - later model-in-loop tests.

## P1 — Required for first AI Mail Operator

8. semantic `mail.reply` and `mail.reply_all`;
9. first-class `mail.forward`;
10. query-backed bulk mail execution;
11. scheduled-send reschedule;
12. recurring-series pause/resume/cancel semantics;
13. account-context contract;
14. tool registry;
15. Modal provider adapter;
16. agent execution loop;
17. SSE execution event stream;
18. desktop/mobile assistant UI;
19. background run status component.

## P2 — Required for broader communication agent

20. calendar availability;
21. invitation accept/decline/tentative;
22. direct event lookup/search semantics;
23. contact identity/merge service;
24. contact relationship history;
25. multiple/per-identity signatures;
26. user-managed template persistence;
27. profile/image asset workflow.

## P3 — Expansion

28. campaign domain;
29. research domain;
30. automations/scheduler;
31. proactive briefings;
32. richer contact/mailbox RAG;
33. file/document/image generation adapters;
34. admin write tools after read-only admin agent is proven safe.

---

# 22. Recommended First Engineering Sprint

Do **not** begin with Modal.

The first sprint should make the application agent-ready without introducing model behavior.

### Sprint A — shared services and contracts

Create:

```text
apps/api/src/services/
  mailService.ts
  outboxService.ts
  calendarService.ts
  contactService.ts
  identityService.ts
  signatureService.ts
  workspaceService.ts
  domainService.ts
  mailboxAdminService.ts

apps/api/src/ai/
  tools/types.ts
  permissions/types.ts
```

Then migrate a small vertical slice through the services:

1. search mail;
2. read message/thread;
3. create/update draft;
4. archive;
5. mark read/unread;
6. send;
7. schedule.

The existing UI must continue to work through the same domain logic.

### Sprint B — agent safety foundation

Create:

- AI conversation/run tables;
- tool/action tables;
- permission grants;
- confirmation records;
- tool idempotency;
- agent-specific audit ledger.

### Sprint C — asset foundation

Create R2 bucket + `AssetService` and migrate agent-facing attachment flow to asset references.

### Sprint D — read-only agent

Only after A-C:

- Modal provider;
- tool registry;
- read-only execution loop;
- SSE stream;
- assistant UI;
- evaluation suite.

Then progressively enable:

```text
read
→ draft/reversible write
→ send/schedule
→ calendar
→ admin read
→ advanced domains
```

---

# 23. Readiness Verdict

## Phase 1 mail operator

**Underlying product capability: strong.**  
Most ordinary mail behaviors already exist.

**Agent infrastructure readiness: not yet ready for implementation of external-action autonomy.**

The correct next move is domain-service and safety normalization, not prompt engineering.

## Calendar/contact agent

**Moderate readiness.**  
CRUD exists, but several semantic actions and identity safeguards are missing.

## File/image agent

**Low readiness until AssetService/R2 exists.**

## Campaign/research/automation agent

**Future subsystem work required.**

## Admin/domain agent

**Read-only readiness is already high.**  
Write capabilities exist for several resources but should be enabled only after the main agent permission, audit, and confirmation architecture is proven.

---

# Bottom Line

GSW Mail does not need to rebuild its core mail product before becoming agentic.

It needs to convert the existing product into a **deterministic, shared capability layer**.

The key transformation is:

```text
Current:
UI -> Routes -> mixed business logic/helpers -> MailEngine/DB

Target:
                    -> UI routes
GSW Domain Services
                    -> Agent tools
       |
       -> MailEngine / DB / R2 / providers
```

Once that layer, permissions, idempotency, audit, conversation state, and assets are in place, the Modal-backed agent can be added without giving the model direct ownership of application logic.


## AI provider abstraction — 2026-10-07

GSW now owns a provider-neutral model contract under `apps/api/src/ai/providers/`.

Implemented adapters:
- `hetzner` — current default, using Hetzner's OpenAI-compatible chat endpoint.
- `openai` — uses the OpenAI Responses API and translates GSW function tools into Responses function tools.
- `anthropic` — uses Anthropic Messages/tool-use and normalizes tool calls back into the GSW tool contract.

The agent runtime no longer calls Hetzner directly. It resolves a provider through `getAiProvider()`, while GSW permissions, confirmations, idempotency, tool registry, action ledger, and domain services remain provider-independent.

Server-level selection is controlled by `AI_PROVIDER=hetzner|openai|anthropic`. Provider credentials remain server-side. User-managed/BYOK credentials are intentionally deferred until encrypted credential storage and per-user provider preferences are added.
