# MCP v2 — Phase 0 baseline and execution trace

**Status:** Initial source audit; runtime evidence and production configuration remain unverified.
**Reference:** [MCP_ARCHITECTURE_V2.md](./MCP_ARCHITECTURE_V2.md)
**Branch:** `mcp-v2/phase-0-baseline`
**Scope:** Documentation only. No production routes, schemas, grants, or mail sending are modified.

## Inventory: current source paths

| Boundary | Implementation | Initial evidence |
| --- | --- | --- |
| MCP transport | `apps/api/src/mcp/routes.ts` | Handwritten JSON-RPC on `POST /mcp`; individual tools and `invoke_tool` are both exposed |
| MCP bearer verification | `apps/api/src/mcp/verifyBearer.ts` | Validates issuer, resource audience, client consent and linked active user; canonicalizes OAuth scopes |
| MCP authorization | `apps/api/src/mcp/resolvePermissions.ts` | Requires OAuth scopes, global settings, active AI grants, and account permissions |
| Native authorization | `apps/api/src/ai/agentExecutor.ts` | Account authorization, capability settings, AI grants, confirmation interventions and reservations |
| Shared registry | `apps/api/src/ai/tools/registry.ts` | Native and MCP call the same `agentMailRegistry`; registry maps provider names to canonical dotted tool names |
| Registry context | `apps/api/src/ai/tools/types.ts` | `AgentExecutionContext` requires `userId`, `authUserId`, `accountId`, `headers` |
| Mail capabilities | `apps/api/src/ai/tools/mailTools.ts` | Draft and send tools use `createMailService(ctx)` |
| Mail services | `apps/api/src/services/mailService.ts` | `engineFor` delegates to `getUserEngine` with context identity and headers |
| Mail engine | `apps/api/src/engine/index.ts` | Checks account membership + auth identity, resolves user-scoped Stalwart token |
| Outbound send | `apps/api/src/outbound/sendFlow.ts` | Outbound reservation and status are separate from MCP action reservations |

## Current sequence: MCP mail.send_draft

1. `POST /mcp` verifies OAuth bearer and obtains linked `userId`, `authUserId`, `clientId`, scopes.
2. `tools/call` resolves tool and account from client arguments.
3. `resolveMcpUserToolPermission` checks scopes, settings, AI grants and account permissions.
4. For writes, `mcpWriteCallPolicy` validates request ID/confirmation and an AI idempotency reservation is stored.
5. Route constructs `{ userId, authUserId, accountId, headers: {} }` and directly calls `agentMailRegistry.execute`.
6. `mail.send_draft` -> `createMailService(ctx).sendDraft(...)` -> downstream mail engine/outbound service (verify complete path during Phase 1).
7. MCP reservation is completed or failed based on registry outcome; this must be correlated with authoritative outbound state before any retry.

## Current sequence: native AI

1. `executeAgentTool` receives `AgentExecutionContext` from native request/run.
2. Native executor checks mailbox authorization, capabilities, grants and confirmation.
3. For writes, native executor reserves an AI idempotency key.
4. Native executor calls the same `agentMailRegistry.execute`.
5. Registry invokes the same mail tool and mail service.

**Known divergence:** Native executor orchestrates permissions/confirmation and receives caller context; MCP duplicates portions of that orchestration in its route and provides empty headers. Empty headers are **not** proof of failure: inspect `getStalwartAccessToken` behavior and runtime traces before changing the identity path.

## Risk register

| Risk | Severity | Guardrail |
| --- | --- | --- |
| Changing shared registry/tool behavior breaks native AI | High | Contract and native regression tests before shared changes |
| MCP identity differs from mailbox membership | High | Verify linked auth user, account membership and credential resolution server-side |
| Duplicate sends after retries | Critical | Inspect outbound status; never replay uncertain operations |
| AI reservation completed while outbound delivery unresolved | High | Reconcile MCP action and authoritative outbound send status |
| OAuth scopes or confirmation accidentally bypassed | Critical | Reject revoked, missing-scope, cross-account and unapproved actions |
| Incompatible SDK cutover | High | Separate adapter, flag and rollback |

## Phase 0 evidence still required

- [ ] Capture live deployment commit SHA, flags, SDK/dependency versions and rollback target.
- [ ] Collect full registry capability list, schema and risk classification.
- [ ] Confirm relevant migrations, existing action reservation tables and background workers.
- [ ] Capture sanitized native draft/send staging trace and success criteria.
- [ ] Capture sanitized MCP draft/send staging trace, including identity and token-resolution stages.
- [ ] Inspect incident `GSW-B082AC70A1CD`, draft ownership and outbound status **without resending**.
- [ ] Establish controlled mailbox test fixtures and authorized test recipient.
- [ ] Add a failing regression test only after reproduction.

## Phase 1 questions (do not assume answers)

1. Does `getStalwartAccessToken` require request cookies/headers for MCP or can it resolve a linked mailbox token via a trusted server-side identity?
2. Is the MCP token subject mapped to the exact account membership's Better Auth user?
3. Does `mailService.sendDraft` reach `submitSend` with the same identity and reservation key as native AI?
4. When a send fails, what does the outbound operation table report: unreserved, queued, sent, failed, or uncertain?
5. Is a previous MCP request ID permanently bound to the same exact action, and can status be looked up without re-executing?

## First implementation gates

- Do not merge changes to mail execution until incident root cause is supported by test or logs.
- No live email is sent by this documentation PR.
- Preserve working native AI draft and send behavior.
- Do not silently retry failed or uncertain sends.
- PR 2: root-cause report + reproducible regression test; PR 3: smallest trusted identity correction; later PRs follow the master architecture.
