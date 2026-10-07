# GSW Mail AI Agent Implementation Plan

> Implementation should begin with the repository audit in [`AI_AGENT_READINESS_AUDIT.md`](./AI_AGENT_READINESS_AUDIT.md). That audit is the current source of truth for capability status, blockers, and Phase 0 priorities.

## Current implementation status — 2026-10-07

The implementation has now started with the safest vertical slice:

- `MailService` is in place for shared search/read/thread behavior used by product routes and agent tools.
- a provider-neutral agent tool contract and registry now exist under `apps/api/src/ai/tools/`;
- the first semantic tools are `mail.search`, `mail.read`, and `mail.read_thread`;
- GSW Chat passes the explicitly selected mailbox/account into the API;
- the Hetzner provider can request these read-only tools through its OpenAI-compatible tool-call interface;
- the backend executes tools only after the existing GSW `read` permission check;
- no mutation/action tools are exposed yet.

Steps 1-5 are now underway. The app has the first shared mail service/tool layer, durable conversation and run persistence, a formal AI permission-scope model, confirmation records, and a dedicated tool-call/result action ledger. Read-only mailbox tools are the only executable agent capabilities. General executor idempotency, SSE streaming, reversible writes, and external actions remain intentionally disabled until their next safety layers are implemented.

---

## Purpose

This document defines the next implementation phase for GSW Mail: an AI-operated communication workspace where users can control mail, calendars, contacts, files, templates, signatures, campaigns, and future automations from a conversational interface.

The goal is not to add a generic AI composer. The goal is to create a backend-controlled agent harness that can reason over user context and call a curated set of GSW-native tools safely.

The intended experience is similar to working with ChatGPT inside a conversation:

- the user asks for an outcome in natural language;
- the model decides what information or actions are needed;
- GSW validates permissions and executes tools;
- tool results are returned to the model;
- the model continues until the task is complete;
- high-impact actions require confirmation where appropriate.

The inference provider should remain replaceable. GSW owns the permissions, tools, state, and execution.

---

## Core Architecture

```text
GSW Web / Mobile
        |
        | natural-language request
        v
GSW AI Gateway / Orchestrator
        |
        +-- conversation state
        +-- user + mailbox context
        +-- permission checks
        +-- tool registry
        +-- confirmation policy
        +-- audit log
        +-- context retrieval
        |
        v
Inference Provider
(initially Modal-hosted model)
        |
        | structured tool request
        v
GSW Tool Executor
        |
        +-- MailEngine / JMAP
        +-- Calendar
        +-- Contacts
        +-- Templates
        +-- Signatures
        +-- File / asset storage
        +-- Image generation
        +-- Research
        +-- Campaigns / Resend
        +-- Scheduler / automations
        |
        v
Tool result returned to model
        |
        v
Final user-facing response
```

### Architectural rule

**Modal is the inference runtime, not the authority layer.**

Modal should generate reasoning and tool requests. It should not directly own credentials, mailbox authority, campaign execution, or persistent automation state.

GSW should own:

- authentication;
- authorization;
- mailbox/account selection;
- conversation state;
- context retrieval;
- tool definitions;
- action execution;
- confirmations;
- audit history;
- scheduled jobs;
- retry and failure handling;
- storage;
- provider switching.

---

## Existing GSW Foundation

The current repository already provides much of the required execution layer.

### Existing MailEngine capabilities

The `MailEngine` abstraction already supports:

- list mailboxes;
- mailbox statistics;
- list messages;
- read full messages;
- read threads;
- mark seen/unseen;
- flag/unflag;
- move messages;
- destroy messages;
- save drafts;
- update drafts;
- save sent messages;
- resolve RFC message IDs;
- read attachments;
- list address books;
- list calendars;
- list calendar events;
- create/update/delete calendar events;
- list/read/create/update contacts;
- search mail.

The AI layer should sit **above** this abstraction rather than bypass it.

### Existing product API capabilities

The current API already includes:

- inbox/folder counts;
- paginated message lists;
- message read/flag/move/archive/trash actions;
- empty Trash;
- thread retrieval;
- sending;
- drafts;
- draft editing;
- sending drafts;
- send status;
- undo/cancel;
- retry;
- search;
- settings;
- signatures;
- contacts;
- contact imports;
- calendars;
- calendar-event CRUD;
- scheduled sends;
- Outbox behavior;
- durable attachment metadata.

This means the first agent release can be built primarily by creating a semantic tool layer over existing routes and services.

---

# Tool Design Principle

Do not expose raw HTTP endpoints to the model.

The model should see semantic actions such as:

```text
mail.reply
calendar.create
contacts.search
signature.update
campaign.launch
```

rather than transport-level routes such as:

```text
POST /mail/send
PATCH /product/calendar-events/:id
```

The tool executor maps the semantic action to the correct internal implementation.

This keeps:

- prompt/tool definitions stable;
- JMAP details out of model context;
- RFC threading logic out of model context;
- providers replaceable;
- permission checks centralized;
- tool schemas easy to reason about.

---

# Proposed GSW AI Tool Registry

## 1. Mail

```text
mail.search
mail.read
mail.read_thread
mail.summarize
mail.compose
mail.create_draft
mail.update_draft
mail.reply
mail.reply_all
mail.forward
mail.send
mail.schedule
mail.schedule_recurring
mail.reschedule
mail.pause_recurring
mail.resume_recurring
mail.cancel_scheduled
mail.archive
mail.move
mail.trash
mail.restore
mail.mark_read
mail.mark_unread
mail.flag
mail.unflag
mail.attach_file
mail.remove_attachment
```

### Important abstraction

The model should not need to know RFC email mechanics.

For example:

```json
{
  "tool": "mail.reply",
  "arguments": {
    "accountId": "account-id",
    "messageId": "message-id",
    "body": "Tuesday works for me."
  }
}
```

The backend should resolve:

- reply recipients;
- thread identity;
- `In-Reply-To`;
- `References`;
- sender identity;
- signatures;
- quoted text;
- attachment rules.

### Bulk mail operations

Add server-side bulk primitives instead of passing large ID arrays through the model:

```text
mail.bulk_archive
mail.bulk_move
mail.bulk_trash
mail.bulk_mark_read
mail.bulk_label
```

The tool should accept a server-side query or filter whenever possible.

---

## 2. Calendar

```text
calendar.list
calendar.search
calendar.read
calendar.availability
calendar.create
calendar.update
calendar.cancel
calendar.respond
calendar.add_attendee
calendar.remove_attendee
calendar.create_meeting_from_email
```

### Missing/high-value primitives

Two especially useful capabilities should be added if not already available through the current engine:

```text
calendar.availability
calendar.respond
```

`calendar.respond` should support:

- accepted;
- declined;
- tentative.

A conversation such as:

> Tell Marcus Thursday works and accept the meeting.

should be able to execute both mail and calendar actions in one agent run.

---

## 3. Contacts

```text
contacts.search
contacts.read
contacts.create
contacts.update
contacts.merge
contacts.tag
contacts.import
contacts.recent
contacts.relationship_history
```

`contacts.relationship_history` can eventually correlate:

- sent mail;
- received mail;
- meetings;
- notes;
- campaign activity;
- follow-up state.

This will allow questions such as:

> When did I last speak with this person?

without requiring the user to manually inspect multiple systems.

---

## 4. Identity and Profiles

```text
identity.get_profile
identity.update_profile
identity.set_profile_image

sender.list
sender.select
sender.create_alias
```

The AI should eventually support:

- changing display name;
- changing profile image;
- selecting the correct sending identity;
- creating or selecting an alias;
- changing identity-specific preferences.

---

## 5. Signatures

```text
signature.list
signature.create
signature.update
signature.delete
signature.set_default
signature.assign_to_identity
```

Examples:

> Create a professional signature from this information.

> Use my ministry signature when I send from this account.

The existing signature storage and sanitation logic should remain the source of truth.

---

## 6. Templates

```text
templates.list
templates.read
templates.create
templates.update
templates.delete
templates.apply
templates.generate
templates.duplicate
```

Example:

> Turn the email we just wrote into a reusable partnership outreach template.

Templates should remain draftable/editable objects and should not imply sending.

---

## 7. Files and Attachments

```text
files.list
files.read
files.generate_document
files.generate_pdf
files.generate_spreadsheet
files.save
files.rename
files.delete

mail.attach_file
mail.remove_attachment
```

Example workflow:

```text
mail.read_thread
      |
      v
files.generate_document
      |
      v
files.generate_pdf
      |
      v
mail.create_draft
      |
      v
mail.attach_file
```

The conversation UI should surface clear action receipts such as:

```text
Proposal.pdf created
Attached to draft
```

Generated assets should be stored by GSW, not treated as temporary model output.

---

## 8. Images

```text
images.generate
images.edit
images.save
images.set_profile_image
images.attach_to_email
```

Example:

> Create a banner for this announcement and put it in the email.

The image service should return a durable GSW asset reference that can be attached or reused later.

---

## 9. Inbox Cleanup and Organization

```text
inbox.classify
inbox.bulk_archive
inbox.bulk_move
inbox.bulk_delete
inbox.bulk_mark_read
inbox.create_rule
inbox.apply_rule
inbox.clean
```

Example:

> Archive obvious newsletters older than 30 days.

Preferred behavior:

1. server calculates the match set;
2. AI reports the number matched;
3. user confirms if needed;
4. server executes the bulk operation.

Do not place thousands of message IDs in model context.

---

## 10. Campaigns

Resend provides a useful reference model for campaign capabilities.

Expose:

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

campaign.contacts.add
campaign.contacts.remove
campaign.segment.create
campaign.segment.update

campaign.metrics
campaign.delivery
campaign.opens
campaign.clicks
campaign.bounces
campaign.unsubscribes
```

### AI-native campaign actions

```text
campaign.research_audience
campaign.research_recipient
campaign.personalize
campaign.generate_variants
campaign.recommend_send_time
campaign.generate_followups
```

Example workflow:

```text
research
   |
   v
contact enrichment
   |
   v
segmentation
   |
   v
personalization
   |
   v
campaign draft
   |
   v
approval
   |
   v
scheduled send
   |
   v
response monitoring
   |
   v
follow-up
```

Campaign execution should remain a separate bounded subsystem from ordinary personal mail.

---

## 11. Research

```text
research.web
research.company
research.person
research.domain
research.summarize
research.save
```

Research results should be able to flow into:

- contacts;
- campaign recipients;
- draft context;
- notes;
- CRM-like metadata;
- templates.

Research should never silently send an email.

---

## 12. Reminders, Scheduled Work, and Automations

```text
automation.list
automation.create
automation.update
automation.pause
automation.resume
automation.delete

reminder.create
reminder.update
reminder.cancel
```

Examples:

> Every morning tell me what needs a response.

> If Daniel has not replied by Friday, remind me.

> Every Monday prepare follow-ups for prospects who have not responded.

> Send me a campaign report at 5 PM.

The scheduler belongs in the GSW backend.

Modal should not remain active waiting for future conditions.

Persist:

- trigger;
- schedule;
- condition;
- user;
- account/mailbox;
- requested tool plan;
- authorization policy;
- last run;
- next run;
- current status.

The scheduler should invoke the AI gateway only when work needs to be evaluated or performed.

---

## 13. Daily Briefings

A briefing should become a native product object.

```text
briefing.create
briefing.update
briefing.run
briefing.pause
briefing.delete
```

A default briefing could include:

- messages needing replies;
- meetings today;
- pending calendar invitations;
- scheduled messages in Outbox;
- recurring sends;
- campaign replies;
- bounces;
- promised follow-ups;
- items awaiting another person's response.

The conversation can then continue naturally:

> Handle the first four.

---

# Connected-Tool Capability Reference

The current ChatGPT-connected tools provide a useful reference implementation.

## Gmail connector currently exposes

- search mail;
- read messages;
- read threads;
- batch-read messages and threads;
- read attachments;
- create drafts;
- update drafts;
- list drafts;
- send drafts;
- send new mail;
- reply within threads;
- forward messages;
- archive;
- Trash;
- create labels;
- apply/remove labels;
- perform bulk label operations;
- inspect the authenticated profile.

## Google Calendar connector currently exposes

- list calendars;
- search events;
- read events;
- check availability;
- create events;
- update events;
- delete events;
- accept/decline/tentatively accept invitations.

## Google Drive connector currently exposes

- search files;
- read Docs/Sheets/Slides;
- create files/folders;
- create/import documents, spreadsheets, and presentations;
- update documents, spreadsheets, and presentations;
- export files;
- upload files;
- rename/move raw files;
- share files;
- delete files.

## Resend connector currently exposes

Broad capability groups include:

- transactional email;
- scheduled email;
- rescheduling/cancellation;
- batch sends;
- broadcasts;
- contacts;
- imports;
- properties;
- segments;
- topics;
- suppressions;
- templates;
- automations;
- domains;
- inbound inboxes and threads;
- inbound drafts/replies/forwarding;
- delivery/engagement metrics;
- logs;
- webhooks;
- OAuth grants;
- API keys.

GSW should use these as a capability reference, not as a reason to mirror provider-specific APIs.

---

# Permission Model

Every AI action must map to a scope.

Recommended scopes:

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
images.write

campaign.read
campaign.write
campaign.send

research.use

automations.read
automations.write

settings.read
settings.write
```

Scopes should be enforced by GSW before a tool executes.

The model should never be trusted to enforce authorization itself.

---

# Action-Risk Classes

Use three default execution classes.

| Class | Examples | Default behavior |
|---|---|---|
| Read | search, read, summarize, metrics | execute without confirmation |
| Reversible write | draft, archive, label, template changes | normally execute directly |
| External / high-impact | send, permanent delete, cancel meeting, launch campaign | require explicit confirmation |

Examples:

- "Draft replies to these five emails." → execute.
- "Send those five replies." → confirm.
- "Prepare a campaign." → execute.
- "Launch the campaign." → confirm.
- "Archive these newsletters." → execute if reversible.
- "Permanently delete Trash." → confirm.

Confirmation policy should be centralized and configurable.

---

# Tool Execution Contract

Every tool should return a normalized response envelope.

Example:

```ts
type ToolResult<T> = {
  ok: boolean;
  toolCallId: string;
  data?: T;
  error?: {
    code: string;
    message: string;
    retryable: boolean;
  };
  audit: {
    userId: string;
    accountId?: string;
    startedAt: string;
    completedAt: string;
  };
};
```

Every tool definition should include:

- name;
- description;
- JSON schema;
- required permission scope;
- risk class;
- idempotency support;
- timeout;
- retry policy;
- audit behavior.

---

# Suggested Internal Tool Definition

```ts
type AgentToolDefinition = {
  name: string;
  description: string;
  inputSchema: object;
  requiredScopes: string[];
  risk: "read" | "reversible_write" | "external";
  execute: (
    ctx: AgentExecutionContext,
    input: unknown
  ) => Promise<ToolResult<unknown>>;
};
```

The tool registry should be provider-neutral.

Modal/OpenAI/other model adapters should convert this registry into the function/tool format required by that model.

---

# Provider Abstraction

Do not bind the agent architecture to GPT-OSS-120B or Modal.

Create an interface such as:

```ts
interface InferenceProvider {
  complete(input: InferenceRequest): Promise<InferenceResponse>;
  stream(input: InferenceRequest): AsyncIterable<InferenceEvent>;
}
```

Initial implementation:

```text
ModalInferenceProvider
```

Potential future implementations:

```text
OpenAIInferenceProvider
AnthropicInferenceProvider
LocalInferenceProvider
```

The AI gateway should not care which provider produced the tool call.

---

# Conversation State

Persist server-side conversation state.

Recommended fields:

```text
conversation_id
user_id
active_account_id
active_workspace_id
title
created_at
updated_at

messages
tool_calls
tool_results
confirmation_requests
attachments
generated_assets
context_refs
```

Avoid sending the entire historical conversation to the model on every turn.

Use:

- recent turns;
- compact summaries;
- relevant tool results;
- retrieved mail/calendar/contact context;
- explicitly pinned context.

---

# Context Retrieval

The model should request context through tools whenever possible.

Examples:

```text
mail.search -> mail.read_thread
contacts.search -> contacts.read
calendar.search -> calendar.read
```

Do not automatically inject the user's entire inbox.

Context should be:

- minimal;
- relevant;
- permission-scoped;
- auditable;
- redacted where appropriate.

---

# Streaming UX

The chat endpoint should use SSE initially.

Suggested event types:

```text
message.delta
message.completed
tool.requested
tool.started
tool.completed
tool.failed
confirmation.required
asset.created
workflow.completed
error
```

Example visible experience:

```text
Searching recent conversations...
Found 4 messages that need replies.

Drafting responses...
4 drafts created.

Ready to send.
[Review drafts] [Send all]
```

The user should see what the assistant is doing without exposing internal chain-of-thought.

---

# Audit Log

Every action taken through the assistant should be traceable.

Store:

- conversation;
- user;
- mailbox/account;
- tool;
- normalized arguments;
- permission decision;
- confirmation record;
- result;
- failure;
- duration;
- provider/model;
- correlation/request ID.

Do not store secrets or raw auth tokens in audit records.

This audit log will become essential for:

- user trust;
- debugging;
- support;
- billing;
- security reviews;
- automation history.

---

# Recommended API Surface

Initial endpoints could be:

```text
POST   /ai/conversations
GET    /ai/conversations
GET    /ai/conversations/:id
DELETE /ai/conversations/:id

POST   /ai/conversations/:id/messages
GET    /ai/conversations/:id/stream

POST   /ai/tool-confirmations/:id/approve
POST   /ai/tool-confirmations/:id/reject

GET    /ai/capabilities
GET    /ai/permissions
PATCH  /ai/permissions

GET    /ai/actions/:id
```

The message endpoint should accept:

```json
{
  "message": "Find the conversations I owe a reply to this week.",
  "accountId": "...",
  "attachments": []
}
```

---

# Phase 1: AI Mail Operator

Build this first.

### Capabilities

- search mail;
- read mail;
- read threads;
- summarize;
- create drafts;
- edit drafts;
- reply;
- reply-all;
- forward;
- send;
- schedule;
- manage Outbox;
- archive;
- move;
- read/unread;
- flag/unflag;
- Trash;
- multi-account selection.

### Goal

A user should be able to complete most ordinary email tasks from chat without touching the conventional inbox UI.

### Example acceptance flows

> Find the last email from Daniel and summarize what he needs.

> Draft a response saying Tuesday works.

> Send it.

> Schedule this announcement for tomorrow at 8 AM.

> Move that scheduled message to Friday.

> Archive all newsletters older than a month.

---

# Phase 2: Calendar + Contacts + Personalization

### Capabilities

- calendar search;
- availability;
- create/update/delete;
- invitation response;
- create meeting from email;
- contact search;
- contact create/update;
- relationship history;
- signatures;
- profile settings;
- templates.

### Example flows

> Find a free 30-minute slot with Sarah next week and draft the invitation.

> Accept the meeting from Jordan.

> Save this sender as a contact and add the company name.

> Create a signature for my business account.

---

# Phase 3: Files + Generated Assets

### Capabilities

- generate documents;
- PDFs;
- spreadsheets;
- images;
- save assets;
- attach assets;
- set profile image.

### Example flows

> Create a one-page proposal from this thread and attach it to a draft.

> Generate a banner for this announcement and add it to the email.

---

# Phase 4: Research + Campaigns

### Capabilities

- web/company/person research;
- recipient enrichment;
- segments;
- campaign creation;
- personalization;
- scheduling;
- launch;
- delivery metrics;
- follow-up generation.

### Example flow

> Find 50 organizations matching these criteria, research each, prepare personalized outreach, and show me the campaign before sending.

---

# Phase 5: Automations + Proactive Briefings

### Capabilities

- recurring jobs;
- conditional follow-ups;
- reminders;
- response watches;
- campaign reports;
- daily briefings.

### Example flows

> Every morning tell me what needs a response.

> If this prospect has not replied by Friday, remind me.

> Every Monday draft follow-ups for unanswered outreach.

---

# Initial Repository Work

Recommended implementation structure:

```text
apps/api/src/ai/
  gateway.ts
  provider.ts
  providers/
    modal.ts
  conversations/
    service.ts
    repository.ts
  tools/
    registry.ts
    types.ts
    mail.ts
    calendar.ts
    contacts.ts
    templates.ts
    signatures.ts
  permissions/
    policy.ts
  confirmations/
    service.ts
  audit/
    service.ts
  streaming/
    sse.ts

apps/api/src/routes/
  ai.ts
```

Potential later additions:

```text
  tools/files.ts
  tools/images.ts
  tools/research.ts
  tools/campaigns.ts
  tools/automations.ts
```

---

# Data Model Additions

Likely new tables:

```text
ai_conversations
ai_messages
ai_tool_calls
ai_tool_results
ai_confirmations
ai_permissions
ai_generated_assets
ai_automations
ai_automation_runs
```

Do not put canonical email content into these tables unless needed.

Prefer references to:

- message IDs;
- thread IDs;
- event IDs;
- contact IDs;
- asset IDs.

---

# Security Requirements

Before enabling outbound actions:

- all tool calls must run under authenticated user context;
- account/mailbox membership must be checked on every call;
- tool scopes must be enforced server-side;
- external/high-impact actions must honor confirmation policy;
- auth tokens must never be sent to the model;
- Modal must never receive JMAP credentials;
- secrets must remain server-side;
- HTML email content must continue through existing sanitation policy;
- generated files/images must be checked against size/type limits before attachment;
- campaign sending must honor suppressions and send limits;
- audit records must exclude credentials.

---

# Non-Goals for the First Release

Do not start by building:

- autonomous outbound campaigns;
- permanent background agents;
- complex cross-provider mailbox federation;
- deep CRM functionality;
- long-term semantic indexing of every message;
- arbitrary code execution;
- direct model access to JMAP credentials;
- a Python microservice solely because Modal is Python-first.

The first release should prove that GSW's existing mail product can be operated safely and naturally through conversation.

---

# Definition of Success

The feature is ready for the first production release when a user can open the GSW assistant and complete the following without using traditional mail controls:

1. Find a conversation.
2. Read and summarize it.
3. Draft a reply.
4. Edit the reply through chat.
5. Send or schedule it.
6. See it in the correct Drafts / Outbox / Sent lifecycle.
7. Archive or organize the original thread.
8. Create a calendar event from the conversation.
9. Search or create the associated contact.
10. Perform the entire sequence against the correct selected mailbox/account.
11. See confirmation prompts before high-impact actions.
12. See a clear activity record of what the assistant changed.

If those flows are reliable, the architecture is ready to expand into files, research, campaigns, and automations.

---

# Product Principle

GSW Mail should not become an email app with an AI sidebar.

It should become:

> **an AI-operated communication workspace with email as its primary system of record.**

The visible inbox remains useful, but conversation becomes another first-class way to operate the entire product.


---

# Confirmed Product Decisions

The following decisions were confirmed before implementation and should be treated as the current baseline unless deliberately changed later.

## Permissions should be revealed in context

Permissions should not be presented only as a one-time setup screen.

When a user asks the agent to perform an action that requires a capability that has not yet been granted, the conversation should explain the requested capability at the moment it becomes relevant and allow the user to approve or decline it.

Example:

> To send this message, GSW Assistant needs permission to send mail from this account.

The approval should grant an explicit scope, not blanket authority.

Permission settings must remain reviewable and revocable outside the conversation.

## Confirmation policy starts from the baseline in this document

The read / reversible-write / external-action model is the initial policy.

It should be designed to evolve without changing individual tool implementations.

Ambiguity and conflicting information must cause the agent to ask rather than guess.

Examples include:

- multiple contacts with the same name;
- conflicting dates;
- unclear sending account;
- unclear recipient;
- conflicting instructions;
- uncertain event identity;
- destructive scope that is wider than expected.

## Account context is explicit and persistent

An agent conversation operating inside a mailbox should always know its active account.

The agent should never infer a different sender identity solely from message content.

Conversation state should include:

```text
active_account_id
active_workspace_id
active_sender_identity
current_route
current_selected_resource
```

Switching accounts must be an explicit state transition and should be visible to the user.

## Memory is layered

Conversation state is required.

User preferences may be stored, but current explicit instructions should be able to override them. Preferences must not become rigid constraints that create unwanted behavior.

Contact memory is desirable and may begin with a simple retrieval/RAG system. Identity resolution must be conservative because confusing two people can corrupt downstream memory and actions.

Mailbox facts are useful, but should retain source references and freshness metadata rather than becoming unsupported permanent facts.

Recommended memory layers:

```text
conversation_memory
user_preferences
contact_memory
workflow_memory
mailbox_facts
```

Contact and mailbox facts should retain provenance whenever practical.

## Durable asset storage is required

GSW currently needs a durable file/image asset layer before generated attachments become a production capability.

A dedicated R2 bucket is an appropriate initial storage target.

Recommended asset model:

```text
asset_id
owner_user_id
workspace_id
account_id?
filename
mime_type
size_bytes
storage_key
source
source_resource_id?
created_by
created_at
updated_at
```

Suggested sources:

```text
upload
email_attachment
generated_document
generated_image
campaign_asset
profile_image
```

The model should work with durable asset references, not raw binary or base64 payloads.

## Personal mail and campaigns remain separate systems

Personal communication and marketing/broadcast communication must not collapse into one sending primitive.

```text
mail.send
campaign.launch
```

must remain separate tools with different:

- permission scopes;
- confirmation requirements;
- send limits;
- suppression rules;
- analytics;
- unsubscribe behavior;
- audit detail.

## Agent evaluation is required before broad write access

A repeatable evaluation suite should be created before enabling unrestricted write actions.

Initial evaluation categories should include:

- correct tool selection;
- correct account selection;
- correct recipient resolution;
- ambiguity handling;
- permission enforcement;
- confirmation compliance;
- idempotency;
- duplicate-send prevention;
- context retrieval accuracy;
- destructive-action safety.

The suite should include realistic multi-step tasks and regressions discovered during development.

---

# Assistant UX

## Desktop placement

The existing right-side message-reading area is the preferred assistant surface.

When no message is selected, the assistant can occupy that open area by default as a slide-out conversational panel.

When a message is opened, the message remains primary and the assistant collapses to a persistent tab on the right edge.

Selecting that tab reopens the assistant over the right-side area.

This allows the conventional inbox and the conversational operating mode to coexist without requiring a separate AI page.

## Mobile placement

On mobile, the assistant should use a full-screen conversational surface or sheet, with clear navigation back to the current mail/calendar context.

## Current UI context

The assistant should know the relevant current application context at all times.

Examples:

```text
current route
selected mailbox
selected message
selected thread
selected contact
selected calendar date/range
selected event
selected template
selected campaign
control-center workspace
selected domain
selected mailbox-admin record
```

Context should contain references and compact metadata rather than blindly injecting full resource contents.

The model should retrieve full content only when needed.

## Execution stream, not private chain-of-thought

The user should see a live, useful stream of work while an agentic flow runs.

Do not expose hidden model chain-of-thought.

Expose action-oriented status events such as:

```text
Searching recent mail...
Found 4 matching conversations.
Reading the latest thread...
Checking Tuesday availability...
Draft created.
Waiting for approval to send.
Message scheduled for 8:00 AM.
```

This stream can appear:

1. inside the open assistant conversation; and
2. in a compact persistent agent-status component while the drawer is closed.

## Top-level background-work indicator

While an agentic workflow continues with the assistant drawer closed, the application header may temporarily replace or visually augment the normal GSW Mail title area with a compact agent status component.

Suggested states:

```text
Working: Searching 3 accounts...
Working: Drafting follow-ups...
Waiting: Needs your approval
Complete: 4 drafts created
Failed: 1 action needs attention
```

When work completes:

- show a completion notification;
- preserve the completed activity in conversation history;
- restore the normal GSW Mail header state.

The component should display execution status, not hidden reasoning.

---

# Phase 0: Agent Readiness

Before implementing the full inference loop, normalize the application so the UI and the agent can use the same deterministic domain services.

## Goal

Anything the agent can do should be available as an application capability independent of the model.

Do not let React implement one behavior while the agent implements another.

Target architecture:

```text
                    +-- React UI
                    |
MailEngine -> GSW Domain Services
                    |
                    +-- AI Tool Registry -> Agent Harness -> Inference Provider
```

## Domain service layer

Introduce or formalize services such as:

```text
MailService
OutboxService
CalendarService
ContactService
IdentityService
SignatureService
TemplateService
AssetService
CampaignService
AutomationService
WorkspaceService
DomainService
MailboxAdminService
AuditService
```

Route handlers should become transport adapters around these services where practical.

The AI tool registry should call domain services, not HTTP routes.

The UI should also migrate toward those same domain services through API routes.

## Readiness artifacts

Before Phase 1, produce and maintain three matrices.

### Capability matrix

For every desired tool:

```text
tool name
existing backend support
domain-service wrapper required
missing backend capability
UI support
mobile support
tests
```

Status values:

```text
ready
needs_wrapper
partial
missing
```

### Permission and confirmation matrix

For every tool:

```text
tool
scope
risk class
confirmation behavior
organization role requirement
account role requirement
bulk threshold
```

### Implementation gap list

A prioritized list of the work required before the first production AI Mail Operator release.

---

# Domain and Administration Capabilities

The assistant should eventually be able to operate beyond the user's inbox when the authenticated user has the required workspace/admin role.

These actions require stricter authorization than ordinary mailbox actions.

## Workspace

```text
workspace.read
workspace.read_health
workspace.read_stats
workspace.read_audit
workspace.list_members
workspace.read_member
workspace.read_mailboxes
workspace.read_mailbox_access
```

Later write capabilities may include:

```text
workspace.invite_member
workspace.update_member_role
workspace.suspend_member
workspace.restore_member
workspace.grant_mailbox_access
workspace.revoke_mailbox_access
```

Every write must enforce current organization permissions.

## Domains

Current repository functionality already includes domain listing, provisioning, DNS state, and verification.

Agent tools should eventually include:

```text
domain.list
domain.read
domain.add
domain.verify
domain.read_dns
domain.diagnose
```

Potential future actions:

```text
domain.retry_provisioning
domain.remove
```

Adding, removing, or changing domain infrastructure should be treated as a high-impact administrative action.

The agent must not receive raw Stalwart or Resend administrative credentials.

## Aliases

The current app already supports listing, creating, and deleting aliases.

Expose:

```text
alias.list
alias.create
alias.delete
```

Creation and deletion require workspace admin/owner authorization and confirmation.

## Mailbox Administration

The current application includes mailbox setup and administrative account state.

Potential tool family:

```text
mailbox_admin.list
mailbox_admin.read
mailbox_admin.create
mailbox_admin.read_access
mailbox_admin.read_quota
mailbox_admin.read_setup_status
mailbox_admin.begin_setup
```

Credential-reset or authentication setup flows should remain specially protected and may intentionally stay outside autonomous tool execution.

## Control Center and operational health

The current admin API exposes control-center data, system health, outbound state, and audit information.

These are valuable read tools:

```text
admin.control_center
admin.health
admin.stats
admin.outbound_status
admin.audit
```

Examples:

> Is anything wrong with mail delivery today?

> Which mailboxes have failed sends?

> Is the domain fully configured?

> Who currently has access to this mailbox?

These can initially be read-only and are strong candidates for the first admin-agent release.

---

# Expanded Permission Scopes

In addition to the previously defined scopes, reserve:

```text
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

Administrative scopes must always be intersected with the user's real organization role.

Possessing an AI preference scope must never elevate a user's underlying GSW role.

---

# Recommended Pre-Implementation Questions

The following questions should be resolved during Phase 0.

## Product authority

- Which reversible actions may run automatically?
- Which actions always require per-action approval?
- Should users be able to create standing approvals for selected actions?
- Should standing approvals expire?
- What bulk-operation thresholds trigger a second confirmation?

## Account context

- Can one conversation intentionally span multiple mailboxes?
- If yes, should the conversation show a visible account chip for each action?
- What happens when the user changes the active mailbox while a workflow is running?

## Identity resolution

- What confidence threshold is required before acting on a contact name?
- When should the agent show a disambiguation picker?
- How are aliases, duplicate contacts, and external directory identities reconciled?

## Memory

- Which preferences are explicitly saved versus inferred?
- Can users inspect/edit stored preferences and contact memory?
- How long do inferred mailbox facts remain valid?
- How is memory provenance displayed?

## Assets

- What R2 bucket and key structure will be used?
- What are retention rules?
- What is the maximum generated asset size?
- What file types may be attached?
- How are malware/file-safety checks handled?
- Are assets private by default and served with signed URLs?

## Campaigns

- Which features belong to GSW versus Resend?
- What defines a personal send versus campaign send?
- When does recipient count force the campaign path?
- Where are unsubscribe, suppression, and compliance states enforced?

## Agent runtime

- Maximum tool calls per turn?
- Maximum workflow duration?
- What happens when the browser closes?
- Which workflows may continue server-side?
- How is cancellation handled?
- How are partial successes represented?

## Administration

- Which admin actions should remain read-only for the first release?
- Which domain/mailbox operations should never be autonomous?
- Should an admin conversation be visibly distinct from a mailbox conversation?

---

# Revised Implementation Order

```text
Phase 0
Domain-service normalization
        |
Capability matrix
        |
Permission + confirmation policy
        |
Idempotency coverage
        |
Audit/activity system
        |
Account-context contract
        |
R2 asset service
        |
Agent evaluation suite
        |
        v
Phase 1
Tool registry
        |
Conversation persistence
        |
Modal provider adapter
        |
Agent execution loop
        |
SSE execution stream
        |
Assistant desktop/mobile UI
        |
Read-only evaluation
        |
Draft/reversible-write evaluation
        |
External-send evaluation
        |
        v
Phase 2+
Calendar, contacts, identity, files,
research, campaigns, automations,
workspace and admin agent capabilities
```

