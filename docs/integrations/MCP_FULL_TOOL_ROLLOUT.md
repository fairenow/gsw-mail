# Full-capability MCP + AI proposal system

## Request
Expose GSW Mail's complete existing AI tool registry (including reads and writes) to remote ChatGPT and Claude connections; allow external AI clients to submit open-ended proposals on bugs, integration ideas and improvements; notify ramon@team.guidedstepswellness.com.

## Implemented foundation
- `capabilityPolicy.ts` derives full capability metadata from the central `agentMailRegistry`; no diverging MCP-only allowlist.
- `proposalContract.ts` validates structured open-ended proposals and renders HTML-escaped notifications with specified recipient.
- No public MCP transport, proposal persistence, mail notification dispatch or OAuth changes are enabled by this commit.

## Production wiring (required before enabling)
1. Use MCP TypeScript SDK v2 `@modelcontextprotocol/server` and `@modelcontextprotocol/fastify` with Streamable HTTP.
2. Complete OAuth Authorization Server/Protected Resource Metadata, resource-specific audience, user and organization ACL checks, client registration/PKCE, revocation.
3. Register every `agentMailRegistry` definition as an MCP tool **only after auth**, retaining exact JSON Schemas; external names use `.` to `__` mapping. Keep per-call permission checks, not just list filtering.
4. Execute using existing registry and the authenticated `AgentExecutionContext`, never elevated service credentials or arbitrary external-user IDs. Confirm approval *inside GSW* for writes that change external state. Client-declared approval flags are not trusted.
5. Introduce a durable `mcp_proposals` table: proposal UUID, tenant/user, client, kind, priority, title, body/evidence, related tool, status, dedupe fingerprint, created/updated timestamps; enforce tenant isolation and size bounds.
6. `mcp.proposal.submit` persists proposal, returns proposal ID and queues notification in durable outbox (do not send synchronously in MCP request). Allow rate limits and deduplication; reject binary/secret data.
7. Deliver notifications through the existing Stalwart outbound path to **ramon@team.guidedstepswellness.com** from a configured GSW mailbox. Log attempts and failures. Do not report notification delivered until provider confirms.
8. Add `mcp.proposal.list`, `mcp.proposal.get`, `mcp.proposal.comment`, `mcp.proposal.review` with role-based permissions and audit trails. Only authorized administrators can accept or close proposals.
9. Add opt-in health/diagnostic evaluation. Models cannot run continuously on their own; trigger checks via approved scheduled workers, not incidental tool output. Never forward arbitrary emails or attachment contents to the reporting address.
10. Audit every read/write including approval id, client, actor, tenant, tool, result, correlation ID and idempotency key. Add per-tenant budgets and admin disable/revoke controls.

## Critical safety / operational rules
- All tools can be **exposed** to properly scoped clients, but no scope alone bypasses internal GSW approval policy.
- External actions (sending email, bulk campaigns, domain changes, deletion, browser purchases etc.) require explicit approval via GSW pending-action record.
- Background jobs remain durable on disconnect; MCP task get/status/cancel reference stable persisted jobs.
- Never auto-execute proposals: proposals are advisory until reviewed.
- Detect prompt injections in untrusted email/browser/file content and maintain strict instruction/data separation.
- No admin tool is made available solely because a remote client requested a broad scope.
- Proposal notification address is fixed for GSW's owner notifications and is not a generic exfiltration destination; metadata-only summaries by default, sensitive content excluded.

## Acceptance
Verify full registry enumeration, read/write scope gates, cross-tenant isolation, independent approval evidence, proposal deduplication, email delivery, failure retries, no notification of prohibited private content, OAuth revoke behavior and disconnect survival.
