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

## Deployment prerequisite

The Railway production service currently uses a narrowly scoped pre-deploy SQL patch and **does not automatically run the Drizzle migration journal**. Before enabling the new first-party approval review routes in production, apply `apps/api/drizzle/0035_mcp_action_approvals.sql` through the established production database migration procedure and verify the table and indexes exist. Do not assume that merging this PR applies the migration. Keep MCP writes disabled until the full execution and approval flow is tested.

### Production migration runner (PR #169)

Once the migration runner has passed CI and merged, preserve the existing Railway pre-deploy `send_policy` patch and append:

```sh
node apps/api/dist/db/applyMcpApprovalMigration.js
```

The command is idempotent and verifies the new approval table in one transaction. A successful build alone does not mean the migration ran; confirm the Railway pre-deploy logs show `MCP approval schema verified` before using approval endpoints. Keep MCP writes disabled.

## Encrypted proposed-draft payloads

The `mcp_action_payloads` table introduced by migration `0036_mcp_action_payloads.sql` holds AES-256-GCM encrypted tool arguments. The payload is authenticated against the approval ID and canonical arguments digest. `storePreparedMcpDraft` inserts the approval and ciphertext in one database transaction; `loadMcpDraftForReview` requires the authenticated GSW user ID, checks that the request is pending and unexpired, decrypts, revalidates, and verifies the digest.

**Configuration prerequisite:** set `MCP_APPROVAL_PAYLOAD_KEY` to a cryptographically random 32-byte key encoded in canonical base64 in the Railway API service secrets. Do not place it in the repository, log it, rotate it without a planned re-encryption or expiration strategy, or reuse a general-purpose app secret. With the key missing, proposed draft storage fails closed. The migration does not require the key.

**Still disabled:** the MCP transport does not yet advertise a preparation or execution tool, and no UI exposes the decrypted review data. Do not enable either until user-facing exact-content review, CSRF protections, OAuth scope checks, account ACL checks, replay/idempotency, and expiration cleanup are implemented and tested. Encrypted records currently expire logically; a scheduled purge must be added before enabling production usage.

## MCP draft preparation transport (opt-in, non-executing)

The `prepare_action` MCP tool supports only `mail.create_draft` and requires `mail.write` OAuth consent, live GSW AI permission, enabled capability settings, and the mailbox ACL. It validates the proposed recipients/content, encrypts and stores the exact arguments for the first-party GSW Security review screen, and returns an approval ID. **It never creates a draft or sends mail.**

The transport remains **off by default** via `GSW_MCP_PREPARE_ENABLED` (only the exact string `true` enables it). Keep this false until the `0036` migration is confirmed, `MCP_APPROVAL_PAYLOAD_KEY` is configured securely, expiration cleanup is scheduled, and end-to-end tests pass. A user with only read scopes must reauthorize the connected client to grant `mail.write`; no implicit scope escalation occurs. Even when preparation is enabled, all registry write execution stays blocked by the existing MCP read-only gate.

Do not expose generic approval execution until one-time claims, crash-safe idempotency, and action result audit are complete.

## Automatic encrypted payload expiration

The API starts `startMcpPayloadRetentionWorker` at boot and every five minutes removes expired encrypted payload rows through `purgeExpiredMcpDraftPayloads`. The approval audit ledger is preserved, and only deletion counts are logged. Failures are logged and retried at the next interval without stopping the API. Multiple API instances can run cleanup concurrently because deletion is idempotent. Cleanup is **not** an authorization mechanism: every review and future execution path must independently enforce approval status, expiry, owner, client, account and argument digest.

The API test command now includes `src/mcp/*.test.ts`, so MCP encryption and policy unit tests are part of the regular CI suite.
