# Community delegated AI and shared execution

## Execution architecture

`apps/api/src/ai/executionEngine.ts` is the single bounded model/tool orchestration loop for native interactive chat (including resume), delegated Community chat, the native scheduled automation worker, and durable model-only chat. The engine owns round budgets, model calls, advertised tool dispatch, matching tool responses, stopping on review, cancellation checks, and optional tool-free finalization. Model-round validation and provider transport live in `modelRound.ts` and `providers/`. The native registry and authorized capability executor remain shared.

Policy adapters are intentionally distinct: native chat uses first-party mailbox permissions and native interventions; delegated chat additionally requires the registered OAuth client, audience, current consent, scopes, subscription, and Community context; unattended scheduled work uses explicit current grants and the approved scope ceiling. The durable model-only worker cannot dispatch tools. Specialized direct artifact routes and explicit confirmation endpoints remain outside the model/tool loop; they use the native executor and their existing authorization. The engine is not a persistent queue or a replacement for application-specific review interfaces.

Each tool adapter must recheck live authorization before effects. A returned review stops the entire batch. Unknown/unadvertised calls and over-budget batches produce paired rejection responses without executing those calls. A repeated provider call ID is rejected before replay. Finalization never receives tools. No automatic retry of a side-effecting turn is introduced.

Modal, Modal DeepSeek and Modal Qwen retain buffered inference. Kimi, Hetzner, OpenAI and Anthropic can emit text deltas only on tool-free rounds; progress status and final results remain available on every provider. Never expose reasoning or raw tool payloads as streamed answer text.

## Delegated integration

The Community uses the registered client, explicit ai.infer consent, MCP resource audience, live consent, mailbox ACL, AI entitlement (including valid exemptions), and current model settings. Persistent delegated conversations are scoped by user, client and mailbox. The JSON chat and streaming routes share the same execution path. Community Convex jobs persist progress and review results independently of the browser.

Reviewed writes are bound to exact arguments, user, account, client, conversation and a short-lived signed review. Native sending remains separate from AI proposals. Campaign launch persists a leased scheduled job with current OAuth consent, account permission and recipient eligibility checks; ambiguous jobs are quarantined rather than blindly replayed. Manual compose review uses native rendering, signature and idempotency. The dedicated review key and registered client configuration remain required; obsolete AI/send preview flags are not used.

## Scheduled connected work

The native scheduler supports explicitly reviewed read-only delegated tasks with a live OAuth consent record, mailbox and approved scope ceiling. Community event reports additionally require an encrypted, event-specific grant, expiring after 90 days and revocable through the event editor. Only bounded aggregate event data is returned; no participant emails or background Community writes are authorized. A revoked or failed delegated grant pauses the scheduled task. No unattended email sending is authorized through this connected workflow.

## Validation

Run API typecheck and the App CI suite, including executionEngine.test.ts, modelRound.test.ts, provider stream parsing, Community policy and encrypted event grant regressions. Test authenticated native and delegated chat, review/confirmation, revocation, event reports and Modal buffered inference before a production release. Frontend preview readiness does not establish Convex backend validation.
