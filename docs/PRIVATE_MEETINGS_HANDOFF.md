# GSW Mail private meetings implementation

Status: signed client, authenticated paid creation route, and receiving Convex metadata API implemented on draft branches. Not enabled or deployed.

## Verified repository integration points

- apps/web/src/pages/CalendarPage.tsx already has meetingLink in EventForm.
- apps/api/src/routes/product.ts validates meetingLink on event creation/update.
- apps/api/src/engine/types.ts supports meetingLink without changing MailEngine.
- apps/api/src/engine/stalwart.ts maps meetingLink to CalendarEvent virtualLocations.
- Calendar invitations use existing queued delivery; never send directly.
- apps/api/src/auth/authorize.ts resolves mailbox membership and organizationId.
- apps/api/src/routes/billing.ts reads billing_subscriptions and explicit mailbox exemptions.
- One free mailbox is not a paid-meeting entitlement. Mailbox exemptions do not automatically grant meetings.
- Bible Study communityLiveStreams requires studySpaceId and ownerUserId. Do not fabricate either for partner meetings.

## Contract v1

GSW Mail calls an HTTPS Convex HTTP action, server to server. Use a dedicated signing secret, never a browser token or LiveKit secret. Each request uses a compact HS256 JWS bearer assertion with issuer gsw-mail, audience bible-study-meetings, a 60-second expiry, random jti, immutable organizer sub, workspaceId, operation, videoMeetings=true entitlement and SHA-256 digest of the exact body. Receiver verifies all claims, consumes jti atomically and validates current entitlement before mutation. Replayed requests fail; business retries use a new jti and the same event idempotency key.

Operations: POST rooms; POST rooms/{meetingId}/handoff; PATCH rooms/{meetingId}; POST rooms/{meetingId}/cancel. No caller-supplied public, recording or social-output settings.

Create body: externalEventId, title, scheduledAt (ISO timestamp), timezone. Identity comes from signed claims. Receiver uniqueness: integration + workspaceId + externalEventId. Same payload returns same room; conflicting payload returns 409. Updates are explicit.

Create response: meetingId, joinUrl, status=scheduled. HTTPS joinUrl must match the configured Bible Study origin. Link creation never provisions media.

Handoff response must contain a single-use, short-lived ticket. Exchange through a POST into a Secure HttpOnly SameSite session; never persist host tickets in event metadata, invitations, local storage or logs. Shared joinUrl only grants guest entry. Receiver stores only ticket hashes and redeems atomically.

## Build order and acceptance

1. Contract/client foundation (this change): signed requests, bounded network timeout, no credential forwarding on redirects, safe provider errors and strict response validation.
2. Canonical Convex backend: separate partnerMeetingLinks/occurrences/participants/hostGrants; workspace and organizer indexes; HTTP signature verification and replay protection. Preserve existing community authorization.
3. Paid access: explicit video_meetings entitlement, checked at create and start; define participant, duration, concurrency limits. Enable for an operator pilot only until limits are configured.
4. GSW Mail authenticated routes: derive workspace from requireAccountPermission; verify calendar/event ownership; preserve stable draft externalEventId through retries; persist association after engine save. Do not accept organizer/workspace IDs from browser.
5. Composer: Add video meeting, creation state/retry, copy/remove, ordinary guest URL saved in existing meetingLink. Organizer Join uses authenticated handoff rather than the guest URL.
6. Event lifecycle: updates/cancellation, orphan recovery after calendar-save failure, recurring-event exceptions. Do not cancel active meetings implicitly.
7. Focused Bible Study web room: guest waiting room, host admission/moderation, device check, screen sharing/chat/gallery. Backend denies discovery, public switches, recording and Egress.
8. Mobile deep links after verified web flow; unsupported clients fall back to web.
9. Real test: paid organizer plus accountless guest; cross-workspace denial, revoked entitlement, replay, concurrent retries and direct broadcast API denial.

## Configuration

GSW_MEETINGS_API_URL: HTTPS Convex HTTP origin.
GSW_MEETINGS_SIGNING_SECRET: dedicated minimum 32-byte secret shared only by backends.
GSW_MEETINGS_WEB_ORIGIN: HTTPS Bible Study web origin.
Feature flag defaults off. No changes to current subscription pricing.

## Rollout

Draft branches first. No production schema migration, billing activation, LiveKit provisioning or customer traffic until backend and end-to-end gates pass.


## Private meeting integration foundation (2026-11-14)

The authenticated POST /product/calendar-meetings route derives organizer and workspace from the signed-in mailbox owner, checks an active/trialing Core subscription with at least one paid mailbox and a future period end, and calls the Bible Study Convex HTTP API. Free mailbox access and mailbox exemptions do not grant meetings. Requests include short-lived body-bound assertions and a videoMeetings entitlement claim. The draft event UUID is namespaced by account ID for idempotency.

GSW_MEETINGS_ENABLED defaults off on both backends. No composer controls are enabled. The receiving backend, host handoff, meeting entry, lifecycle synchronization and device acceptance must be released together before enabling customer use. See PRIVATE_MEETINGS_HANDOFF.md.

Receiver branch: feature/private-meeting-api-20261114 in fairenow/bible-streaming-app. Invitation URLs use /meet/{meetingId}; the entry screen is not implemented yet, so do not enable this feature. Host grants and LiveKit provisioning remain pending.
