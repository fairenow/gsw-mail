# GSW Delivery — service boundary and staged extraction

## Product position
GSW Mail is customer zero. GSW Delivery is an emerging multi-tenant email delivery and marketing infrastructure product backed by Stalwart, with a controlled own-app API pilot implemented in code. The service must be proved against internal authentication, onboarding, and small opted-in campaigns before opening a developer API.

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
The Control Center Email Delivery panel manages the controlled pilot: installations, explicit sender/recipient grants, test/live mode at creation, pause/resume, and server key creation/revocation. Customer webhooks, public OAuth onboarding and marketing remain future work. Do not advertise deployment acceptance or public availability until verified.

## Cutover safeguards
- Deploy with OUTBOUND_RELAY=stalwart only; check Stalwart submissions and OTP inbox arrival before deleting RESEND_API_KEY or package-lock dependencies.
- Keep marketing launches disabled until suppression/unsubscribe and sender-domain audits pass.
- Admin email is for authentication and notifications. Prefer a separately provisioned marketing identity/domain with a monitored reply mailbox once campaigns grow.

## October 30, 2026 pilot update

A controlled own-app API pilot is now implemented in code, with a Control Center Email Delivery panel replacing the coming-soon placeholder. It uses installation-scoped server keys, fixed sender/recipient grants, test simulations, queued live acceptance, status polling and quotas. Production migration and real-host delivery acceptance remain required. This is not the broader external developer beta or marketing launch. The concrete contract and customer process are in [email API pilot](integrations/email-api-pilot.md); remaining service work is in [GSW Mail API service plan](GSW_MAIL_API_SERVICE_PLAN.md).
