# GSW Mail: Stalwart-only sending and marketing rollout

## Architecture and sender identity

- The sole production transport is Stalwart using JMAP identity-validated submissions; OUTBOUND_RELAY must be stalwart.
- Transactional sender: **admin@team.guidedstepswellness.com** (sign-in codes, account verification, password reset, account deletion verification, and new-inbox welcome).
- Suggested marketing sender: **updates@team.guidedstepswellness.com** after the operator provisions it in Stalwart; replies should go to a monitored GSW mailbox. Do not impersonate admin or use an unprovisioned sender identity.
- Existing outbound queue, delivery callbacks, suppression records and campaign service remain the foundation. Do not introduce a second provider for the marketing flow.

## Before production authentication cutover

1. Confirm the admin mailbox exists in the product database, is bound to a Stalwart principal, and has a matching JMAP Identity/get sender.
2. Ensure the deployment's OUTBOUND_RELAY is set to **stalwart**; a legacy **resend** value is deliberately rejected on startup.
3. In a production-safe test account, request sign-in OTP, verify address, and password reset; verify Stalwart accepts them and they arrive in external inboxes.
4. Verify DNS MX, SPF, DKIM and DMARC alignment for the sending domain; inspect actual message headers and external mailbox placement.
5. Monitor queue failures and Stalwart delivery logs. Only after successful cutover remove obsolete RESEND_API_KEY secrets and the unused SDK/lockfile dependency.

## Marketing platform phases

### Phase 1 — Consent and compliance (blocking)

- Explicitly separate transactional email from subscribed promotional email.
- Record contact consent source, timestamp, list purpose, sender brand, and status (subscribed/unsubscribed); do **not** treat everyone emailed or saved in Contacts as subscribed.
- Provide a visible physical postal address, truthful sender and subject, and functioning unsubscribe in each promotional email.
- Provide a single-click unsubscribe mechanism (List-Unsubscribe + List-Unsubscribe-Post where applicable) and landing-page opt-out, without login.
- Apply opt-out suppression immediately before queued delivery, respect all previously unsubscribed addresses, and process complaints and hard bounces.
- Follow applicable CAN-SPAM and other recipient-jurisdiction laws, plus Gmail/Yahoo bulk-sender requirements; consult legal/compliance review before launch.

### Phase 2 — Delivery and observability

- Enforce per-mailbox and per-domain rate limits, daily caps, pause controls, idempotency, retries only for safe temporary failures, and queue visibility.
- Expose campaign status per recipient: draft / approved / queued / submitted / delivered / deferred / bounced / complained / unsubscribed.
- Rate-limit sends and ramp volume progressively based on observed reputation. Separate marketing reputation from the admin/OTP mailbox.
- Verify webhook signatures for delivery and complaint ingestion; reconcile out-of-band Stalwart status.

### Phase 3 — Campaign manager

- Audience segments by opt-in source and purpose, saved templates, variables with safe escaping, plain-text + HTML, preview/test sends, scheduled sends, approval and immutable recipient snapshots.
- Reuse the existing AI campaign service and outbound worker; do not send directly from an interactive API request at scale.
- Add dashboards for sent/delivered, bounces, complaints, unsubscribes, and qualified replies (avoid tracking pixels as a default).
- Provide role-scoped permissions and audit trails for marketing operators.

### First-party campaign sequence

| Timing | Audience | Content | Goal |
|---|---|---|---|
| Account creation | New account (transactional) | Welcome and feature tour | Activation |
| Day 2–3 | Users subscribed to tips | How to connect inbox, use Chat, and manage Contacts | First successful workflow |
| Day 7 | Users subscribed to tips | Calendar and Scheduled Work walkthrough | Retention |
| Day 14 | Users subscribed to product updates | Files, privacy controls, feedback invitation | Product education |
| Monthly | Product news subscribers | Release digest and use cases | Engagement |

Start with a small, consented internal pilot, verify deliverability, then expand gradually. No external bulk marketing send is authorized by this document.
