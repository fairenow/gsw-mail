# Ramon / Alyssa / community acceptance

## Automated local acceptance

Run `npm run test:acceptance --workspace apps/api`. This runs the two-user scenarios against `gsw_mail_test`, with a temporary HTTP server, demo mail storage and null relay. It resets the dedicated test database and closes its HTTP server and pool afterward. Override TEST_DATABASE_URL only with a URL whose database is `gsw_mail_test`. Never point it at the development or production database.

The scenarios verify private mailbox isolation, shared community access, read-only send denial, and Alyssa queuing mail as community with an attachment that Ramon can inspect. Run `npm run test:integration --workspace apps/api` for concurrency, replay, reconciliation, admin authorization and retry coverage. An unavailable database is a failure, not a skip.

## Live deployment acceptance

Provision Ramon and Alyssa with separate identity subjects and private accounts. Give Ramon owner access and Alyssa delegate access to community@. Ensure neither has membership in the other's private account. Log in with each real JWT in separate browser profiles.

1. Verify each user sees their private mailbox and community, but receives 403 when requesting the other's private account UUID.
2. Send external test mail to each private address and community. Verify delivery and attachment bytes in the intended mailbox. Confirm both users see the same community thread.
3. Send from Ramon to Alyssa and reply as Alyssa. Send as community from Alyssa with a small attachment. Verify external receipt, exact attachment bytes, From identity, threading and one Sent copy.
4. Repeat a send with the same clientRequestId; confirm one queue operation. Cancel during the five-second undo window. Confirm no external receipt. Exercise a relay failure and retry, and verify one Sent copy.
5. Confirm delivery webhook replay produces one provider event. Verify bounce/complaint suppression and that subsequent sends to the suppressed address fail.
6. Supply organizationId explicitly for every admin request. Verify Alyssa cannot administer the organization and Ramon cannot read an unrelated organization.
7. Inspect received headers for SPF, DKIM and DMARC results. Record timestamps, send IDs, relay IDs, recipients, failures and the deployed image digest.

### Stalwart bearer-session acceptance

After any Stalwart OIDC or JWKS configuration change, restart only the
Stalwart service before this check. For each real identity, confirm the API
records `jmap_session_start` followed by `jmap_session_success`, with safe
metadata showing `tokenFormat: jwt`, issuer
`https://mail.guidedstepswellness.com/api/auth`, audience `stalwart`, and the
actual mailbox address. Confirm `GET /.well-known/jmap` returns HTTP 200 and
that the session exposes only the user's own and explicitly delegated
accounts.

Run this with Ramon, then Alyssa, `support@`, `admin@`, and `test@` in
separate browser profiles. Do not log bearer tokens, recreate principals, or
use shared credentials.

Live acceptance status: not run; requires a running Stalwart host, real identities, relay credentials and test recipients. Automated acceptance does not demonstrate Internet delivery.
