# MCP Write Authorization — Implementation Contract

**Status:** Phase 2 in progress; write execution remains disabled in `/mcp`.

## Why

The current MCP transport deliberately exposes and executes only tools with `risk: "read"`. The agent registry already contains reversible writes (drafts, contacts, files) and external actions (send, campaigns), but OAuth scope alone must never authorize those actions.

## Security boundaries

1. Authenticate the OAuth resource token, resolve its real user and client, and enforce revocation.
2. Require the tool's OAuth scopes, active GSW AI capability grants, and account-level ACL at each invocation.
3. Load approval evidence **from the server's database**, never from client-supplied tool arguments.
4. Bind approval to user ID, account ID, OAuth client ID, exact tool name, and canonical argument digest.
5. Reject expired, pending, rejected, revoked, or consumed approvals.
6. Atomically claim the approval before execution (compare-and-set / transaction); a second request cannot reuse it.
7. Reserve an idempotency key for retry-sensitive operations; return the previous completed result where safe, never execute a second send.
8. Audit approval ID, client, user, account, tool, digest, outcome, and correlation ID without logging sensitive message bodies.
9. Never enable write execution until the persisted approval store, atomic consumption, and execution path are complete and tested.

## Implementation status

- `writeApprovalPolicy.ts`: pure, fail-closed validation of persisted approval evidence; canonical SHA-256 digest binds exact arguments.
- `writeApprovalPolicy.test.ts`: checks identity/client/account/tool/argument binding and rejected/expired/consumed states.
- **Persistence implemented in current PR (pending CI/merge):** constrained `mcp_action_approvals` migration, Drizzle schema, owner-scoped pending request storage, first-party GSW list/decision routes, and atomic one-time claim of an approved record. The approval table stores only an argument digest, not the raw email/file payload.
- **Not yet implemented:** MCP prepare-action entry point, protected argument payload storage/retrieval, user-facing approval UI, end-to-end write execution, idempotent result ledger, and integration tests against a real database.
- **Not enabled:** no changes to `mcp/routes.ts` write gates; write tools remain unavailable through MCP.

## Suggested API contract

- `mcp.prepare_action` validates an operation, returns a human-readable summary and an approval request ID; it does not perform the action.
- GSW authenticated UI reviews and approves or rejects that exact request.
- `mcp.execute_approved_action` executes only a server-loaded approved record, atomically claims it, rechecks all current permissions, and returns structured results. It must not accept arbitrary substituted arguments.
- Optionally allow narrowly scoped, explicit standing permissions for non-consequential reversible writes in a later phase; never silently grant them through generic OAuth consent.

## Verification checklist

- Cross-user, cross-account, cross-client, scope downgrade, revocation, changed arguments, expired approval, duplicate execution, and concurrent requests are all rejected or safely deduplicated.
- External sends and campaign launches are confirmed by GSW, not a boolean in MCP arguments.
- A failed action returns an accurate error and never reports successful delivery or persistence without evidence.

Related: [Superpowered MCP plan](MCP_SUPERPOWERED_CAPABILITY_PLAN.md), [Remote MCP architecture](REMOTE_MCP.md).
