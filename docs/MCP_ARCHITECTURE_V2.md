# GSW Mail MCP Architecture v2
## Technical Architecture, Refactoring & Implementation Plan

**Status:** MCP v2 operating in production; public multi-user distribution audit in progress (see Section 13). The credential bridge is deployed, but public-release readiness is not established.
**Repository:** `fairenow/gsw-mail`  
**Primary API:** Fastify / TypeScript  
**Production MCP endpoint:** `https://api.guidedstepswellness.com/mcp`  
**Target clients:** ChatGPT, Claude, OpenCode, OpenClaw, and other standards-compliant MCP hosts  
**First priority:** Explain and resolve MCP mail execution failures without disrupting native GSW Mail.

> **Architectural commitment:** GSW Mail is the product. Its application services and capability engine remain authoritative. MCP is a secure, standardized interface to those existing capabilities—not a second application backend.

## 1. Executive summary

GSW Mail already has a functioning native AI productivity system that can draft and send email and invoke application capabilities across mail, calendar, contacts, files, and other services. The initial MCP implementation connected to ChatGPT, exposed tools, added OAuth authorization, and exercised read/write paths, but also introduced parallel permission and execution logic and exposed an unresolved mail-send failure.

Architecture v2 will preserve the existing application and replace or refactor only the integration boundaries necessary to provide reliable, secure, interoperable tool execution.

### Goals

1. One authoritative business implementation per capability.
2. One shared, trusted execution contract for native AI, MCP, and authorized automations.
3. User-scoped identity, authorization, and internal mailbox credential resolution.
4. Standards-based MCP transport using the official TypeScript SDK.
5. Individually discoverable, schema-validated tools generated from the existing registry.
6. Durable write operation state, safe retries, and auditable results.
7. Automated native-AI/MCP parity and security testing.
8. Staged production migration with explicit rollback.

### Non-goals

- Replacing Stalwart/JMAP, PostgreSQL, object storage, background workers, Fastify, or the native chat frontend.
- Reimplementing mail/calendar/contact/file business logic in MCP.
- Giving third-party AI clients unrestricted mailbox access.
- Introducing a new orchestration framework without a proven requirement.
- Deploying all architectural changes in one large PR.

## 2. Existing architecture and baseline

| Component | Existing responsibility | Decision |
| --- | --- | --- |
| Fastify API | Application routes and request handling | Retain |
| Better Auth | Sessions and OAuth | Retain; clarify MCP resource and scopes |
| Stalwart / JMAP | Mailbox and message operations | Retain |
| PostgreSQL / Drizzle | Product data, grants, execution records | Retain |
| Object storage | Files and attachments | Retain |
| AI tool registry | Tool contracts and implementations | Retain; make authoritative |
| Native AI chat | First-party AI user experience | Protect from regression |
| Background workers | Asynchronous and scheduled execution | Retain |
| Railway / Vercel | API / frontend hosting | Retain |

### Initial code inventory

- `apps/api/src/mcp/routes.ts`
- `apps/api/src/mcp/verifyBearer.ts`
- `apps/api/src/mcp/resolvePermissions.ts`
- `apps/api/src/mcp/writeTestPolicy.ts`
- `apps/api/src/ai/agentExecutor.ts`
- `apps/api/src/ai/tools/registry.ts`
- `apps/api/src/ai/tools/mailTools.ts`
- `apps/api/src/ai/agentState.ts`
- `apps/api/src/services/mailService.ts`
- `apps/api/src/outbound/sendFlow.ts`
- `apps/api/src/engine/index.ts`
- `apps/api/src/auth/better.ts`

Expand this inventory as execution traces identify additional dependencies.

### Baseline evidence

- Native GSW Mail AI was manually tested and successfully created and sent email. This is useful evidence, **not** complete regression coverage.
- MCP `mail.send_draft` failed under incident `GSW-B082AC70A1CD`: OAuth permission was granted and the MCP endpoint responded, but the application returned `mail_failed`. Delivery was not confirmed.
- The MCP route constructs an execution context with `headers: {}` and invokes the tool registry directly; the native outbound flow resolves a user mail engine using authenticated identity and request context. **Authentication-context mismatch is a hypothesis, not a confirmed root cause.**
- Before retrying that failed send, inspect the draft and outbound operation state to avoid duplicate delivery.

## 3. Target architecture

```text
Native AI ──────────┐
ChatGPT MCP ────────┤
Claude MCP ─────────┼──> Shared execution layer
Other MCP hosts ────┤      | identity, authorization, approval
Automations ────────┘      | validation, idempotency, audit
                           v
                   Existing capability registry
                           |
                           v
                    Application services
                           |
                Stalwart / DB / storage
```

### Boundary responsibilities

**MCP adapter:** protocol negotiation, Streamable HTTP, MCP OAuth verification, discovery, tool-call translation, and MCP result encoding. It must not implement mail business rules or obtain internal credentials through untrusted client headers.

**Shared execution layer:** resolve a trusted principal and mailbox, enforce caller-specific consent and common authorization, validate inputs, coordinate approvals and idempotency, invoke the registry, and return structured results with audit metadata.

**Capability registry:** authoritative tool names, descriptions, schemas, scopes, risk classifications, and application-service bindings. It must not depend on ChatGPT or MCP.

**Application services:** authoritative implementation of mail, calendar, contacts, files, tasks, and outbound delivery. Must remain usable independently of MCP.

## 4. Architecture decision records

### ADR-001 — MCP is a protocol adapter

MCP calls the shared executor; it never creates a parallel business-service implementation. A business-rule change must be made in one authoritative place.

### ADR-002 — Official TypeScript MCP SDK

Evaluate, pin, and adopt a compatible official MCP TypeScript SDK release, including its supported Fastify/Streamable HTTP integration. Confirm supported protocol revisions and client compatibility at implementation time. Keep the legacy transport available during staged migration and remove it only after parity and rollback validation.

### ADR-003 — Shared trusted execution context

Proposed contract (illustrative, subject to the audit):

```ts
interface GswExecutionContext {
  principal: { userId: string; authUserId: string };
  accountId: string;
  caller: { type: "native_ai" | "mcp" | "automation"; clientId?: string };
  authorization: { scopes: ReadonlySet<string> };
  trace: { correlationId: string; operationId?: string };
}
```

External MCP bearer tokens establish the external client's identity and consent. Internal mailbox credentials must be resolved server-side for the authenticated user and account; never forward unrelated client tokens or blindly trust request headers.

**Credential brokerage (implemented).** A sessionless MCP request carries no Stalwart credential, so mailbox tools fail closed (`mailbox_session_required`) rather than substituting the MCP bearer. Two server-side mechanisms close the gap:

- **Connect-time broker.** A first-party product session route (`POST /product/mcp/mailbox-credential`) accepts only a browser session cookie from a trusted GSW origin; it rejects mixed `authorization`+`cookie` and any MCP bearer. While the signed-in user is present it runs a PKCE authorization-code exchange against the product's own mobile client with `scope=openid email offline_access` and `resource=stalwart`, so Better Auth persists a refreshable, account-bound mailbox authorization. The web consent screen calls this best-effort before the OAuth decision.
- **Refresh bridge.** For a later sessionless request, `refreshStoredStalwartMailboxToken` reuses only a persisted first-party refresh token (filtered by principal, non-revoked, unexpired, enabled client) and performs a server-side `refresh_token` grant to `${issuer}/oauth2/token`. The renewed token is verified against the trusted JWKS with account/metadata binding before use, cached briefly, and skipped on any failure. No credential is ever minted from an MCP grant; the token endpoint, not the caller, is authoritative.

The empty-header MCP path (`mcp/executionContext.ts`) remains; identity and mailbox authority come exclusively from the resolved product session, not from request headers.

### ADR-004 — Unified authorization policy, distinct consent

Effective permission requires the authenticated principal, client OAuth consent where applicable, AI capability grants, mailbox/organization ACLs, risk classification, and any necessary user approval. A native AI grant must not bypass MCP OAuth scopes; an MCP consent must not silently expand native AI privileges.

### ADR-005 — Individual tools derived from the registry

Publish explicit tools such as `mail_search`, `mail_create_draft`, `mail_send_draft`, `contacts_search`, and `calendar_create_event`, with stable names, schemas, descriptions, scope requirements, and accurate annotations. A generic `invoke_tool` dispatcher may remain temporarily for compatibility but should not be the primary public interface.

### ADR-006 — Durable action lifecycle

```text
received -> authorized -> validated -> awaiting_approval (if required)
         -> reserved -> executing -> completed | failed | uncertain
```

The underlying outbound service is authoritative for send state. HTTP 200 does not prove delivery. Replayed or timed-out calls must not create duplicate external effects.

### ADR-007 — Secure, actionable observability

Capture correlation ID, operation ID, tool, caller, execution stage, sanitized error code, retry classification, duration, and final state. Never log bearer tokens, internal credentials, message bodies, or attachment contents.

## 5. Phased implementation roadmap

### Phase 0 — Baseline, safety, and inventory

**Objective:** Establish a reproducible baseline before changing shared execution code.

- [ ] Record production commit, deployment, flags, and rollback target.
- [ ] Inventory registered capabilities and current MCP tool schemas.
- [ ] Diagram native AI and MCP entry points and authorization paths.
- [ ] Inventory shared database tables, migrations, and workers.
- [ ] Record working native AI draft/send behavior.
- [ ] Identify production-safe staging and mailbox test fixtures.
- [ ] Create an architecture decision log and regression risk register.

**Deliverables:** current-state diagram, capability catalog, auth flow, baseline, risk register.

**Gate:** We can trace native AI and MCP to the same mail operation and identify every identity and permission boundary. No production refactor before this gate.

### Phase 1 — Root cause of MCP mail failure

**Objective:** Reproduce and explain incident `GSW-B082AC70A1CD`.

- [ ] Trace native AI `mail.send_draft` end to end.
- [ ] Trace MCP `mail.send_draft` end to end.
- [ ] Compare trusted user identity, account selection, headers, and credential resolution.
- [ ] Inspect `getUserEngine(...)` and downstream Stalwart authentication.
- [ ] Verify draft ownership, lookup, and outbound submission.
- [ ] Inspect the failed draft and outbound operation state **without resending**.
- [ ] Add sanitized, stage-specific diagnostics only where needed.
- [ ] Reproduce failure with controlled fixtures and add a failing regression test.

**Hypotheses:** (H1) missing auth context; (H2) user identity mismatch; (H3) downstream authorization mismatch; (H4) draft/account mismatch; (H5) outbound persistence/JMAP failure.

**Deliverables:** evidence-backed root-cause report, reproduction, smallest architectural correction proposal, regression test.

**Gate:** Root cause established by evidence, not by the presence of an empty headers object alone.

### Phase 2 — Shared execution contract

**Objective:** Normalize trusted identity, authorization, and execution without rewriting business services.

- [ ] Finalize `GswExecutionContext`.
- [ ] Implement trusted principal and mailbox resolver.
- [ ] Separate external OAuth authentication from internal credential brokerage.
- [ ] Define a transport-neutral `executeCapability` interface.
- [ ] Centralize authorization decisions while preserving caller-specific consent.
- [ ] Centralize validation, approval checks, result and error contracts.
- [ ] Define idempotency ownership and audit metadata.
- [ ] Add account-isolation, revocation, and permission tests.
- [ ] Migrate mail read/draft/send first; expand only after parity.

**Gate:** Native AI and MCP execute the same mail capability through the same contract, with equivalent authorized business effects.

### Phase 3 — Standards-based MCP transport

**Objective:** Replace handwritten JSON-RPC/transport logic with the SDK-backed adapter.

- [ ] Select and pin the official SDK release.
- [ ] Implement isolated Streamable HTTP server/handler.
- [ ] Preserve OAuth resource metadata, discovery, and consent behavior.
- [ ] Implement initialization, tool discovery, and call translation.
- [ ] Generate individually named tools and validated schemas from registry.
- [ ] Provide correct risk annotations and bounded structured results.
- [ ] Support pagination and stable tool naming.
- [ ] Test against MCP Inspector, ChatGPT, and an independent SDK client.
- [ ] Keep legacy endpoint or rollback mechanism until cutover passes.

**Proposed organization (adapt to repository rather than moving files gratuitously):**

```text
apps/api/src/
  capabilities/
    registry.ts
    execute.ts
    context.ts
    authorization.ts
    results.ts
  mcp/
    server.ts
    transport.ts
    auth.ts
    toolAdapter.ts
    toolSchemas.ts
    resultAdapter.ts
  services/
    mailService.ts
    calendarService.ts
    contactService.ts
    fileService.ts
```

**Gate:** A non-ChatGPT MCP client can discover and execute the same supported tools without client-specific application logic.

### Phase 4 — Reliability, idempotency, observability

**Objective:** Make every consequential action safe and diagnosable.

- [ ] Define stable operation IDs and canonical argument fingerprints.
- [ ] Bind idempotency to principal, client, account, tool, and arguments.
- [ ] Define one authoritative action state and status lookup.
- [ ] Link MCP mail-send status to existing outbound send records.
- [ ] Prevent duplicate effects after timeout, retry, or reconnect.
- [ ] Define handling for `uncertain` actions; never silently retry them.
- [ ] Add structured stage-level logs, error categories, and correlation IDs.
- [ ] Add timeouts, cancellation semantics, metrics, and alerts.
- [ ] Validate that sensitive payloads are not exposed in diagnostics.

**Gate:** External writes have verifiable status; replay and timeout tests produce no duplicate effects.

### Phase 5 — Capability catalog and parity

**Objective:** Expose existing capabilities consistently.

| Priority | Group | Examples |
| --- | --- | --- |
| P0 | Mail read | Search, list, read |
| P0 | Mail drafts | Create, update, retrieve |
| P0 | Mail send | Send draft, inspect send status |
| P1 | Contacts | Search, retrieve, create |
| P1 | Calendar | List, create, update, RSVP |
| P2 | Files | Search, upload, download, organize |
| P2 | Tasks | Create, update, list |
| P2 | Automations | Schedule, inspect, manage |

- [ ] Generate the catalog from the registry, not a duplicate MCP list.
- [ ] Use stable names, precise descriptions, and validated schemas.
- [ ] Verify account selection and per-tool OAuth scopes.
- [ ] Add output schemas and accurate risk annotations.
- [ ] Test large responses, pagination, and invalid inputs.
- [ ] Add native-AI/MCP parity tests for each published capability.

**Gate:** Every published MCP tool maps to one authoritative application implementation and has contract coverage.

### Phase 6 — Security and interoperability

**Objective:** Validate authorization boundaries and cross-client compatibility.

- [ ] Expired, missing, revoked, wrong-audience, and unauthorized-client tokens.
- [ ] Missing scope, denied capability, and denied mailbox ACL.
- [ ] Cross-user and cross-organization access.
- [ ] Prompt injection through tool results and untrusted mail content.
- [ ] Malformed arguments and oversized responses.
- [ ] Duplicate IDs, replayed approvals, and disconnected clients.
- [ ] No credential or sensitive output leakage.
- [ ] ChatGPT, MCP Inspector, and independent SDK client tests.
- [ ] Optional Claude/OpenCode/OpenClaw compatibility tests.

**Gate:** Required security tests pass; at least two independent MCP client implementations can invoke the supported tool set.

### Phase 7 — Production migration and cleanup

**Objective:** Cut over without disrupting native GSW Mail.

- [ ] Deploy the new adapter to staging.
- [ ] Run native AI regression and MCP contract suites.
- [ ] Run controlled live mail and calendar parity checks.
- [ ] Verify OAuth compatibility and database migration safety.
- [ ] Deploy behind a flag or isolated route.
- [ ] Canary production traffic and monitor error rate and latency.
- [ ] Cut over only after release gates pass.
- [ ] Remove redundant legacy transport and owner-only test paths.
- [ ] Update runbooks and operational documentation.

**Rollback:** Preserve previous working deployment; avoid irreversible schema changes at cutover; be able to disable MCP writes without disabling native sending; never automatically replay uncertain sends.

**Gate:** Production parity and security checks pass, native AI remains functional, and legacy code can be safely removed.

## 6. PR strategy and engineering quality gates

| PR | Scope | Dependency |
| --- | --- | --- |
| 1 | Architecture documentation, inventory, baseline | None |
| 2 | MCP send reproduction and root-cause report | PR 1 |
| 3 | Trusted identity / credential resolution | PR 2 |
| 4 | Shared execution and authorization contract | PR 3 |
| 5 | Mail capability parity | PR 4 |
| 6 | SDK-backed MCP transport | PR 4 |
| 7 | Registry-generated individual MCP tools | PR 6 |
| 8 | Action status, idempotency, diagnostics | PR 5 |
| 9 | Security and multi-client tests | PRs 6–8 |
| 10 | Cutover, cleanup, and runbooks | All release gates |

Each PR should have one architectural purpose, a small reviewable diff, relevant typecheck/lint/unit/integration coverage, authorization tests, and explicit rollback notes. Changes to shared execution code must include native AI regression tests. Merging code alone does not complete a phase.

## 7. Regression and parity matrix

| Operation | Native AI | MCP |
| --- | --- | --- |
| Search Inbox | Required | Required |
| Read message | Required | Required |
| Create draft | Required | Required |
| Update draft | Required | Required |
| Send draft | Required | Required |
| Search contacts | Required | Required |
| Create calendar event | Required | Required |
| Reject unauthorized action | Required | Required |
| Handle expired credentials | Required | Required |
| Handle interrupted execution | Required | Required |

Compare **business effects**, not only HTTP success. A send test requires verified outbound state and an explicitly authorized controlled recipient.

### Release criteria

- 100% passing core capability contract tests.
- 100% passing account isolation and authorization tests.
- Zero duplicate external effects in retry/timeout tests.
- No unresolved critical/high security findings.
- No confirmed native AI regressions introduced by migration.
- Successful controlled draft and send through both interfaces.
- Successful independent MCP discovery and execution.
- Traceable operation IDs for every write.

Establish production latency and error-rate targets from measured baselines, not arbitrary guesses.

## 8. Risk register

| Risk | Mitigation |
| --- | --- |
| Native AI regression | Baseline, shared-code contract tests, canary |
| OAuth incompatibility | Test audiences, consent, and refresh behavior |
| Identity / credential confusion | Trusted server-side credential resolver |
| Duplicate email sends | Durable idempotency and authoritative outbound status |
| Excessive permissions | Layered authorization and explicit client consent |
| SDK incompatibility | Pin release, stage, preserve rollback |
| Spaghetti code | Strict boundaries, single registry, small PRs |
| Opaque errors | Stage-level structured observability |
| Scope creep | Priority tiers and phase exit gates |

## 9. Required living documentation

Maintain alongside implementation:

1. `docs/MCP_ARCHITECTURE_V2.md` — this master plan.
2. `docs/MCP_EXECUTION_CONTRACT.md` — trusted context and execution.
3. `docs/MCP_CAPABILITY_CATALOG.md` — tools, schemas, scopes, risk.
4. `docs/MCP_SECURITY_MODEL.md` — OAuth, grants, approvals, threat model.
5. `docs/MCP_TEST_MATRIX.md` — regression, contract, interoperability.
6. `docs/MCP_MIGRATION_RUNBOOK.md` — deployment and rollback.
7. `docs/MCP_DECISION_LOG.md` — decisions and trade-offs.

Tracked so far in `docs/MCP_V2_PHASE0_BASELINE.md` and `docs/MCP_V2_PHASE1_SEND_INVESTIGATION.md`. The remaining documents above are still planned deliverables, not files that already exist.

## 10. Working agreement

Before each phase: inspect existing code, confirm impacted files and native AI risks, establish a failing or baseline test, implement the smallest coherent change, run CI and integration checks, review for unnecessary complexity, verify deployment where applicable, and record remaining risks.

A phase is complete only when its acceptance criteria are demonstrated—not merely when its PR merges.

## 11. Immediate next milestone

**MCP Mail Execution Parity**

1. Record current production baseline.
2. Trace native AI and MCP `mail.send_draft`.
3. Establish the root cause of incident `GSW-B082AC70A1CD`.
4. Verify the failed draft and outbound status before any resend.
5. Design and test the trusted execution-context correction.
6. Prove the original native GSW Mail draft/send flow still works.
7. Only then finalize the shared executor and begin the SDK migration.

## 12. Definition of done

- **Functional:** Native AI and MCP execute the same authorized capabilities reliably.
- **Architectural:** One registry, one authoritative business implementation per operation, one shared execution contract.
- **Security:** No bypass of OAuth consent, mailbox ACLs, or approvals.
- **Reliability:** Durable write status, safe retries, traceable failures.
- **Interoperability:** ChatGPT and independent MCP clients work without client-specific business logic.
- **Maintainability:** Protocol code isolated, duplicated logic removed, new tools exposed from the registry.
- **Production safety:** Original GSW Mail remains functional throughout migration.

---

## Engineering references

Validate versions and compatibility at implementation time.

- [Model Context Protocol specification](https://modelcontextprotocol.io/specification)
- [Official MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [MCP Inspector](https://github.com/modelcontextprotocol/inspector)
- [OpenAI MCP developer guidance](https://developers.openai.com/plugins/build/mcp-server)
- [OWASP MCP Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/MCP_Security_Cheat_Sheet.html)

**Final principle: Build MCP around GSW Mail—not GSW Mail around MCP.**

## 13. Public ChatGPT plugin release audit — 2026-10-18

This section **extends**, rather than replaces, the internal MCP v2 architecture, ADRs and technical roadmap above. The six public-release phases below derive from the public-launch handoff. "Implemented" means code exists; it does **not** mean the feature has cleared multi-user, interoperability, security, and production acceptance testing.

### Evidence and current deployment

- Production Railway `gsw-mail` API deployed commit `3fa8ea662a3c755e3887bf832be56add91f599ed` (PR #185, mailbox credential broker). At audit time Railway reported deployment SUCCESS.
- Live MCP capability discovery returned **97 registered capabilities**: **36 available_for_read**, **34 available_for_test_write**, **27 oauth_scope_missing** for the audited connected user. These labels are consent- and environment-specific, **not** multi-user release certifications. Top-level host tool counts include bootstrap functions and do not directly equal the registry count.
- Prior real-world user tests reported mailbox reading, draft preparation, queued send, CC delivery to Gmail and forward delivery to Zoho. These demonstrate a functioning user flow; native reply threading, comprehensive parity and independent-account validation remain separate gates.
- The current `mcp/routes.ts` uses handwritten JSON-RPC responses and `canUseMcpWriteTestMode`; the public write policy is therefore **not complete**. `mcp/capabilityDiscovery.ts` retains status vocabulary `available_for_test_write` and `write_transport_disabled`.
- `mcp/verifyBearer.ts` validates JWT issuer/audience, live client consent, subject mapping, and scopes; `routes/mcpMailboxCredential.ts` implements first-party mailbox credential establishment. This is implementation evidence, **not** proof of two independent customer accounts or revocation behavior in all production scenarios.
- Existing v2 roadmap checkboxes remain historical/planned tasks; evaluate them against current tests rather than treating the unchecked boxes as proof of absent code.

### Six-phase public-launch readiness matrix

| Public phase | Current audit | Evidence | Work needed before declaring complete |
| --- | --- | --- | --- |
| 1. Production architecture and tool audit | **Partial** | Single application registry, per-tool scope/risk entries, 97-item live catalog | Export full machine-readable catalog with public/internal/admin classification, missing-scope decisions, schemas, output boundaries and contract tests; establish an allowlisted public v1 catalog |
| 2. OAuth and account isolation | **Partial; P0** | Validated MCP bearer, consent checks, account ACL enforcement, connect-time credential broker, refresh path | Replace owner-only write-test gating with explicit production per-user consent and approval; verify two unrelated accounts, independent refresh/revocation, disconnect, and cross-user/cross-resource isolation |
| 3. Email tool reliability | **Partial; P1** | Read, draft and send paths exist; reported Gmail/Zoho delivery | Exercise full mailbox operations and failure/retry cases; decide on dedicated reply/reply-all/forward; verify `In-Reply-To`/`References`, recipients, attachments, duplicate effects, authoritative outbound state |
| 4. Security and privacy | **Partial; P0** | Layered grant/ACL checks, approval and durable idempotency implementation, sanitized incident IDs | Security assessment of all public tools, untrusted content/prompt injection, abuse/rate limits, operational alerts, safe error audit, revocation and legal/support policy review |
| 5. Plugin package and branding | **Unverified** | Existing private plugin package and hosted HTTPS MCP endpoint | Confirm current OpenAI submission requirements, publisher/domain verification, release package file formats, branding, legal URLs, reviewer fixtures and package scans before asserting compliance |
| 6. Production testing and review | **Partial / release gate open** | Local agent reported 247 unit, 19 integration, 4 acceptance tests after bridge; independent production mail-delivery evidence reported | Re-run CI against release SHA, collect client-by-client and user-by-user evidence, perform controlled production canary/rollback, submit and resolve review feedback |

### Public v1 capability policy (proposal; not yet enforced)

Define an explicit `public-v1` allowlist rather than treating all 97 registry capabilities as approved for public use. Start with reliable mail read/search/thread, draft creation/editing, controlled send, folders, contacts read/search, basic calendar read and optional files read. Add reply/forward once native threading is demonstrated. Exclude or defer admin tools, campaigns, background automations, arbitrary browser actions, media generation, permanent deletes, and experimental functions until separately reviewed. The earlier **20–30 tool** target is a product planning guideline, not a submission requirement. Preserve full internal/native registry coverage; filtering belongs at the MCP publication boundary.

### Non-negotiable public production write model

- Do not globally enable owner-only test mode for all users or bypass existing approvals. Replace it with authenticated user- and client-specific OAuth grants, resource ACL checks, least privilege, explicit confirmation for consequential effects, durable request IDs, and one authoritative action status.
- Disconnection/revocation must invalidate client authorization and broker access for that connection; access-token renewal must never broaden mailbox authority.
- Audit reads and writes for account ownership, scope, recipient/attachment bounds, and safe error output. Never pass the external MCP bearer as a Stalwart bearer.
- Preserve internal ChatGPT developer integration as a rollback path while introducing a separate public rollout policy.

### Implementation workstreams and exit gates

**A. Inventory and exposure:** Generate `docs/MCP_CAPABILITY_CATALOG.md` or a reproducible JSON export from the registry; classify every tool, choose a public allowlist, add per-tool contract coverage. **Exit:** every published tool has an audited scope/risk/schema and demonstrated behavior.

**B. Public auth and credential lifecycle:** Implement production write policy independent of `GSW_MCP_WRITE_TEST_USER_ID`, with per-user approvals and revoked-client handling. Test independent real GSW users plus isolated organizations/mailboxes, expired or rotated credentials, unauthorized write attempts and disconnected clients. **Exit:** no cross-user exposure and no owner-only requirement for legitimate writes.

**C. Reliable email primitives:** Add or validate native reply/reply-all/forward semantics and correct threading headers, CC/BCC, stored file attachments, send status, pagination, and retry safety. **Exit:** every public mail operation has live controlled end-to-end evidence.

**D. Security and operations:** Red-team tool input and untrusted email, enforce rate/size/time limits, verify monitoring and incident IDs, and review public privacy/support/terms URLs. **Exit:** no outstanding high/critical findings and a documented rollback plan.

**E. Package and review:** Verify *current* official publishing instructions and actual plugin file structure before packaging. Existing private package uses `.app.json` + `.codex-plugin/plugin.json`; do not assume a separate `mcp.json` is required without validating the target publishing workflow. **Exit:** valid package, verified publisher requirements, reviewer test credentials, five positive/three negative scenarios or the current required equivalent.

**F. Release acceptance:** Validate ChatGPT and at least one other standards-compatible MCP client; test two independent user accounts, read/write authorization, disconnect/reconnect, failures, and controlled external delivery. **Exit:** CI and required security suites pass, public tools work for regular users, no duplicate effects or confirmed privilege bypasses, and rollout can be reversed safely.

### Public readiness status

**Not yet cleared for public publication.** The principal P0 blockers are production multi-user write authorization, independently evidenced cross-user security, and a validated public exposure/submission policy. Public launch should not depend on making all 97 capabilities public.

### Documentation maintenance

Update this section with PR links, release SHA, acceptance evidence, known exceptions, and current submission requirements after each gate. Do not treat manual user success reports, deploy SUCCESS, or available_for_test_write as interchangeable evidence of general availability.
