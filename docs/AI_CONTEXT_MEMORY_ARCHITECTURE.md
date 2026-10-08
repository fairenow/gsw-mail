# GSW Chat Context, Compaction, and Memory Architecture

## Goal

GSW Chat should preserve continuity without replaying an ever-growing transcript into every model call. The design must work well with today's Qwen default, remain provider-neutral, and improve automatically as larger or stronger models are selected later.

The system should distinguish four things that are often incorrectly treated as one:

1. **Transcript** — durable, verbatim conversation history.
2. **Working context** — the bounded material sent to the model for this turn.
3. **Compaction** — a loss-aware summary of older conversation state.
4. **Memory** — reusable knowledge promoted beyond one local turn or thread.

The transcript is the source of truth. Compaction and memory are derived indexes and can be rebuilt.

---

## Current GSW behavior

GSW already has a strong persistence foundation:

- `ai_conversations` and `ai_messages` retain conversation history.
- Tool calls/results have their own ledger.
- Tool result persistence is already sanitized so large mailbox/tool payloads do not automatically become permanent transcript bloat.
- Conversation history is restorable from the server.

The current context path is much weaker:

- The web client restores only the latest **24** visible user/assistant messages.
- Sending a turn trims the browser working set to roughly the latest **23/24** messages.
- The API chat schema accepts at most **24** messages.
- There is currently no model-aware context budget, no automatic compaction snapshot, and no server-side reconstruction of a long thread from transcript + summary + recent tail.

That means a conversation can be durable in the database while silently losing older conversational context supplied to the model.

---

## Design principle: never equate UI history with model context

The UI should be free to display the complete transcript.

The model request should be assembled independently by a server-side **Context Engine**.

The client should send:

- conversation ID
- the new user turn
- attachments for the new turn
- mailbox/runtime selection

It should not be responsible for deciding which old messages the model remembers.

---

## Hybrid architecture

### Layer 1 — Immutable transcript ledger

Keep every user/assistant message in `ai_messages`.

Do not delete old messages when compacting.

Store stable sequence/order information so snapshots can declare exactly which message range they summarize.

Suggested additions:

- message sequence number
- token/character estimate
- compacted-through snapshot ID
- optional embedding/index status

Raw transcript remains available for:
- UI history
- audit/debugging
- re-compaction
- user export
- future stronger-model reprocessing

### Layer 2 — Conversation state snapshot

Add `ai_context_snapshots`.

A snapshot should contain a structured, incremental summary rather than a paragraph.

Suggested shape:

```text
Objective
Important details
Decisions
User preferences relevant to this thread
Entities / people / projects
Completed work
Active work
Blocked items
Artifacts and files
Tool-derived facts
Next moves
```

Columns:

- `id`
- `conversation_id`
- `through_message_id` / sequence
- `summary`
- `structured_state jsonb`
- `approx_tokens`
- `model/provider used`
- `created_at`
- `supersedes_snapshot_id`

Keep snapshots versioned. The newest one is active, but older snapshots make compaction debuggable and reversible.

### Layer 3 — Recent conversational tail

Always preserve a recent tail verbatim.

OpenCode's implementation has two useful ideas worth adopting:

- compact older material while preserving a token-budgeted recent tail
- leave a safety buffer for the next model response and tool work

Do not choose the tail by a fixed number of messages. Choose it by tokens.

Initial GSW target:

- reserve 20–25% of context for output/tool expansion
- preserve roughly 20–30% for the recent verbatim tail
- let the remaining context be system + snapshot + recalled knowledge + current turn

For smaller models, the tail shrinks automatically.
For a future 1M-token model, the same engine can simply retain more raw context.

### Layer 4 — Tool-output pruning

Tool outputs are often the largest and least reusable context.

Borrow OpenCode's distinction between the **fact that a tool was called** and the **full historical output**.

After a tool result has been consumed:

- retain tool name
- retain important identifiers
- retain a compact result digest
- retain artifact/message IDs needed to reopen the source
- drop the large raw payload from future model context

Examples:

```text
mail.search → 84 results
Relevant IDs: [...]
Query: yesterday / sent
```

instead of replaying all 84 messages.

For files:

```text
files.analyze
Share the Leadership.mp4
46 sec vertical product demo
Analysis artifact: ...
```

The file remains in R2 and can be re-read if necessary.

### Layer 5 — Durable user knowledge

Add a separate memory system rather than turning every compaction summary into global memory.

Suggested table: `ai_memory_items`.

Memory classes:

- `preference` — writing/style/tool preferences
- `identity` — durable user/account facts
- `project` — ongoing project facts and architecture
- `decision` — deliberate decisions that should persist
- `contact` — relationship/context information
- `workflow` — recurring process preferences
- `fact` — other stable reusable knowledge

Each memory item should have:

- canonical text
- type
- scope: user / workspace / mailbox / project / conversation
- entity keys
- confidence
- importance
- source message IDs
- provenance type
- first/last observed
- last recalled
- recall count
- expires/TTL when appropriate
- superseded_by
- excluded/deleted flag
- embedding

Never store a memory without provenance.

### Layer 6 — Promotion rather than automatic global remembering

A strong distinction from naive RAG:

**Observed context is not automatically durable knowledge.**

Promote something into memory when one or more are true:

- user explicitly states a preference/decision
- fact appears repeatedly
- fact is reused in separate conversations
- model classifies it as high-value durable project context
- user pins/promotes it

Temporary facts such as today's email count should normally expire or remain transcript-only.

### Layer 7 — Hybrid recall

Recall should combine deterministic and semantic retrieval.

Order of operations:

1. **Exact runtime context**
   - selected mailbox
   - active draft
   - attached files
   - currently referenced contacts/entities
2. **Thread state**
   - latest compaction snapshot
   - recent verbatim tail
3. **Deterministic memory match**
   - entity/project/mailbox IDs
   - explicit tags
4. **Lexical search**
   - names, subjects, exact phrases
5. **Vector search**
   - semantic similarity
6. **Ranking**
   - relevance
   - recency
   - importance
   - confidence
   - scope proximity
   - prior successful recall

This prevents an embedding similarity score from overriding obviously more relevant mailbox/project state.

### Layer 8 — Context Capsules

Introduce a GSW-specific concept: **Context Capsules**.

A capsule is the small active knowledge package for the task currently being worked on.

Example:

```text
Capsule: Bible Study outreach
Goal: create/send church outreach
Current assets: flyer PDF, Bible Study logo
Writing preference: natural, concise
Relevant contacts: ...
Recent decision: ...
Open work: ...
```

A capsule is assembled dynamically from transcript state + memories + artifacts. It is not another permanent copy of all information.

Capsules make context reusable across:
- Chat
- Mail drafting
- Files
- automations
- future calendar/contact agents

This is especially valuable in GSW because the assistant operates across multiple product surfaces.

---

## Context budgeter

Every provider/model should advertise a context limit.

Before each model call:

```text
usable = model_context
       - desired_output
       - safety_buffer
```

Allocate the usable budget roughly:

- system + permissions: fixed/minimized
- current user turn: always full
- active tool state: always enough to complete the current action
- recent verbatim turns: high priority
- conversation snapshot: high priority
- retrieved memories: ranked until budget reached
- historical raw turns: only if budget remains

Never wait for the provider to throw context overflow.

Trigger compaction before crossing the pressure threshold.

Initial trigger target: **~70–75% of usable input context**.

Hard-overflow recovery:
1. prune old tool payloads
2. compact older transcript
3. retry once with reconstructed context
4. if still too large, preserve newest task and explicitly tell the user what could not be retained

---

## Compaction strategy

Use incremental anchored compaction similar to OpenCode.

When pressure is reached:

1. Take the prior snapshot.
2. Select transcript messages after that snapshot.
3. Keep a token-budgeted recent tail verbatim.
4. Summarize only the older head.
5. Merge prior snapshot + new head summary.
6. Persist the new snapshot.
7. Build the model request from:
   - new snapshot
   - recent tail
   - current turn
   - retrieved memories

Important rule:

Anything omitted from a new snapshot must either:
- be intentionally obsolete, or
- remain recoverable from source transcript/memory.

The compactor should explicitly preserve:
- corrections
- user constraints
- identifiers
- file names/asset IDs
- current blockers
- unfinished work
- commitments/decisions

---

## Memory extraction should not block chat

After a successful turn, enqueue lightweight background extraction:

```text
conversation turn
    ↓
candidate memory extractor
    ↓
deduplicate / merge / supersede
    ↓
embed/index
```

The user should not wait for this work before seeing the response.

If background processing fails, conversation continuity still works from the transcript and compaction snapshot.

---

## Model-neutral representation

Do not store provider-specific prompt blobs as memory.

Store GSW canonical structures.

Then adapt them at request time for:
- Qwen
- OpenAI
- Anthropic
- future local models

This is where the architecture becomes exponentially more valuable with stronger models: better models get richer source material and a larger recent tail without requiring a redesign of the memory system.

---

## Suggested database additions

### ai_context_snapshots

- id
- conversation_id
- through_message_id
- through_sequence
- summary
- structured_state jsonb
- approx_tokens
- provider
- model
- supersedes_id
- created_at

### ai_memory_items

- id
- user_id
- workspace_id nullable
- account_id nullable
- conversation_id nullable
- type
- canonical_text
- entity_keys jsonb
- confidence
- importance
- source_message_ids jsonb
- provenance jsonb
- embedding
- first_observed_at
- last_observed_at
- last_recalled_at
- recall_count
- expires_at
- superseded_by
- deleted_at

### ai_context_usage

Per model call:

- conversation_id
- run_id
- model
- context_limit
- estimated_input_tokens
- snapshot_tokens
- recent_tokens
- memory_tokens
- tool_tokens
- system_tokens
- compaction_triggered
- created_at

This gives us the equivalent of OpenCode's context meter and lets us tune empirically.

---

## First implementation sequence

### Phase A — Stop silent context loss

1. Stop having the browser own the complete model history.
2. Send only the new turn + conversation ID.
3. Server reconstructs model context.
4. Add model-specific token budgeting.
5. Preserve full UI transcript separately.

### Phase B — Compaction

1. Add snapshot table.
2. Build structured incremental compactor.
3. Preserve recent tail by token budget.
4. Trigger automatically before overflow.
5. Add tool-output pruning.
6. Record context metrics.

### Phase C — Memory

1. Add scoped memory table.
2. Add asynchronous candidate extraction.
3. Add exact/lexical recall first.
4. Add pgvector semantic recall.
5. Add dedupe, supersession, TTL, provenance.
6. Add user-facing memory/privacy controls.

### Phase D — Context Capsules

1. Assemble project/task capsules dynamically.
2. Share capsules across Chat/Mail/Files.
3. Track which recalled facts actually helped.
4. Re-rank memories using successful usage.

---

## Guardrails

- Raw transcript is never destroyed by compaction.
- A generated summary is not treated as more authoritative than its source.
- Mailbox facts should be re-read from mail tools when freshness matters.
- User corrections supersede older memory.
- Sensitive or ephemeral content should not be promoted merely because it appeared once.
- Memory deletion/exclusion must prevent future recall.
- Tool permissions remain independent of memory/context. Remembering a fact does not grant permission to act on it.

---

## Key takeaway

GSW should not become a system that simply “stores more chat.”

It should become a system that **maintains a small, high-quality working set over a durable source-of-truth history**.

The durable transcript gives fidelity.
Compaction gives continuity.
Memory gives reuse.
Retrieval gives relevance.
Context Capsules give task focus.
Token budgeting makes the entire system model-aware.

That architecture lets a relatively constrained model work efficiently today and allows a future stronger/larger-context model to immediately use more history and richer recall without changing the underlying data model.
