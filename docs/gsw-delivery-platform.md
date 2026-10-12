# GSW Delivery — service boundary and staged extraction

## Product position
GSW Mail is customer zero. GSW Delivery is a future multi-tenant email delivery and marketing infrastructure product backed by Stalwart. The service must be proved against internal authentication, onboarding, and small opted-in campaigns before opening a developer API.

## Architecture decisions
- Keep Stalwart as transport/storage; GSW Delivery owns product APIs, tenant identity, job status, idempotency, quotas, sender domains and marketing compliance.
- Define an internal DeliveryClient interface now so GSW Mail does not directly depend on an external public HTTP API. Introduce HTTP endpoints and SDK only after internal contracts stabilize.
- Every delivery operation must carry organizationId, projectId (nullable for legacy internal requests), senderIdentityId, requestId, purpose (transactional|marketing), and caller authorization. All persistent reads/writes must be tenant-scoped.
- Use transactional outbox + worker: accept and validate => persist => enqueue => deliver through Stalwart => reconcile terminal status. Prefer at-least-once worker execution with idempotent submission and dedupe, not misleading exactly-once claims.
- Never give external developers Stalwart admin credentials or direct JMAP superuser access. Scoped credentials and permission policy live in the GSW service.
- Public API candidate (not yet exposed): POST /v1/emails, GET /v1/emails/:id, POST /v1/domains, GET /v1/domains/:id, GET /v1/usage, webhook configuration. Avoid exposing campaigns until consent and suppression infrastructure is complete.
- Use one shared sending core for transactional and marketing emails, but separate sender reputation, content rules, consent requirements, opt-outs, quotas and default policies.

## Milestones and acceptance criteria
1. **Transactional parity**: Authenticate through existing GSW flows, deliver verification/reset/welcome from admin@team.guidedstepswellness.com through Stalwart; inspect sender alignment, inbound reachability and delivery status; confirm repeated requests cannot cause accidental duplicate dispatch.
2. **Sender isolation**: Verify domain/identity ownership; outbound requests from one tenant must not access another tenant's sender, recipient logs, or templates. Add cross-tenant negative tests.
3. **Durable delivery contracts**: Persist request IDs, immutable payload versions, provider submission IDs and delivery events; test replay, crash recovery, retries, bounces and non-duplicating requests.
4. **Marketing compliance foundation**: Explicit opt-in, durable consent audit, unsubscribe tokens and one-click headers, hard-bounce/complaint suppression, per-tenant and global limits, human approval and opt-out rechecks at send time. Do not send promotional campaigns until done.
5. **Pilot**: Send limited internal and subscribed campaigns, verify complaint/bounce trends and DNS before scaling. Require an operator kill switch.
6. **External developer beta**: Project-scoped keys, domain verification, safe HTTP endpoints, SDK examples, documentation, usage metering, quotas, monitoring and abuse screening. Pricing and billing follow proven stability.

## Admin experience
Show a non-actionable “Email Delivery — Coming soon” section in Control Center. Explain transaction API, delivery webhooks and permission-based marketing. No dead or misleading CTA; do not advertise publicly operational features.

## Cutover safeguards
- Deploy with OUTBOUND_RELAY=stalwart only; check Stalwart submissions and OTP inbox arrival before deleting RESEND_API_KEY or package-lock dependencies.
- Keep marketing launches disabled until suppression/unsubscribe and sender-domain audits pass.
- Admin email is for authentication and notifications. Prefer a separately provisioned marketing identity/domain with a monitored reply mailbox once campaigns grow.
