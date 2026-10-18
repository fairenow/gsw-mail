# MCP v2: Phase 1 source investigation

Status: source review only; root cause requires staging evidence.

## Observations

- The MCP route uses the established tool registry and supplies an execution context without native request headers.
- The mail service uses that context for account-bound mailbox engine resolution.
- Credential resolution can use an appropriate bearer, cached state, or an authorization-code process that may require an existing first-party session.
- The MCP route persists its own action reservation, but its stable operation key is not passed into the registered mail-send tool. The downstream outbound workflow may therefore use a different idempotency identifier.
- A successfully queued outbound operation does not itself prove message delivery.

## Next gates

1. Inspect sanitized failure-stage diagnostics and the original draft/outbound status without re-sending.
2. Reproduce the failing credential path in staging using a controlled mailbox and verify identity/account binding.
3. Add regression tests for authorized and revoked principals, cold credential resolution, and repeated action IDs.
4. Correct the smallest confirmed execution boundary; preserve native AI behavior.
5. Verify both clients against the same authoritative outbound operation state before SDK migration.

No production operation was initiated by this investigation.
