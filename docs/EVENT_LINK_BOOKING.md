# Event Link booking

Status: implementation on `feature/event-link-booking-20261115`; not enabled in production until merged and deployed. No booking links or notification emails have been created on the live service by this change.

## Owner flow

Settings → Event Link is scoped to the selected mailbox. Only a mailbox owner with manage permission can publish a link. Saving an enabled link explicitly authorizes background calendar checks, calendar creation, and queued transactional booking mail using that mailbox's existing renewable OAuth credentials. A missing/revoked mailbox connection fails closed; reconnect the mailbox before enabling its links.

The owner sets a booking name, globally unique slug (`/book/{slug}`), destination calendar and IANA timezone. Multiple links are supported, with at most 20 per mailbox. Pausing a link prevents new requests and preserves existing bookings. Renaming its slug changes the public URL; existing booking records are retained.

Two scheduling modes:

- Exact slots: publish dated start times with a fixed duration of 15, 20, 30, 45, or 60 minutes.
- Windows: publish weekly day/start/end windows; guests choose among the enabled durations. Candidate starts use five-minute intervals and must fit fully inside a window.

Owners can exclude dates, set advance notice from 1 to 720 hours, choose manual or automatic approval, require phone/message, and supply a location or HTTPS meeting URL. Name and email are always required. An optional paid private-meeting setting creates an isolated Bible Study meeting link for each confirmed booking through the existing signed integration. Both feature configuration and paid/operator entitlement remain required; booking links alone do not bypass meeting access.

## Guest flow

`/book/{slug}` is public and bypasses the mail login gate. It shows a month calendar, day slots and durations, with browsing through six calendar months from the organizer's current date. Calendar days follow the schedule timezone; individual time choices explicitly display the visitor timezone, including date. Selecting a day and a time opens the guest form. Submission revalidates availability, duration and required fields on the server.

A success screen distinguishes an approval request from an automatically reserved booking and redirects to the GSW Mail home page after 15 seconds. It also offers an immediate return link. No success response claims that email has already been delivered.

## Approval, calendar and email

Pending manual requests reserve their time until the earlier of their start time or 24 hours after submission. Both guest and owner receive a pending receipt; the owner's email links to the authenticated settings tab. Owners approve or decline in Settings → Event Link. Confirmed/declined/expired notices go to both parties as separate messages. Guest confirmation includes a UTC `.ics` calendar attachment and the ordinary meeting URL, when configured. Organizer credentials never enter public URLs or email.

Automatic approval reserves the slot immediately and queues calendar creation. A 15-second worker rechecks the current calendar, creates the calendar event through MailEngine, and then queues confirmation emails. Calendar writes have a stable booking UID for reconciliation. Failures and ambiguous operations are surfaced as Needs calendar review; they are never silently called confirmed. Expired auto-approved jobs do not create past events. Email delivery uses submitSend and the existing outbound queue; per-notification idempotency keys protect manual retries from duplicate sends. Failed/uncertain notices remain visible for owner review and explicit retry.

## Conflict and privacy rules

An account-scoped transaction advisory lock serializes reservations across every event link for a mailbox. Live calendar events and pending/approved/confirmed/attention bookings block overlapping slots. Idempotent guest retries use a request UUID and payload digest. Submitted organizer/account IDs are never accepted from public clients. Owner operations recheck mailbox manage permission. Guest endpoints reveal available intervals, not calendar titles, attendee details or OAuth state.

The Stalwart booking reader pages beyond the normal 200-event UI limit, normalizes calendar timezones and all-day dates, and excludes cancelled/free events. Unverifiable durations, partial provider responses, calendars over the 5,000-event verification cap, and recurring calendar events currently make public availability unavailable. Recurring busy-event expansion is a release limitation, not an assumption that those intervals are free. Weekly booking availability itself is supported. Confirmed calendar events manually edited/deleted outside Event Link do not automatically cancel the corresponding reservation in this first release.

Public booking POST is limited to five requests per IP per hour, plus 100 new bookings per mailbox per day. There is a honeypot, bounded input sizes, strict schemas, a six-month horizon, minimum advance notice, hashed request payloads and no-store/noindex API responses. These controls reduce abuse; they do not verify ownership of a guest's email address. Booking metadata contains guest contact details and must be treated as private customer data.

## Deployment and verification

Migration `0049_event_links.sql` creates event_links, event_bookings and event_booking_mail. Startup also performs the same additive idempotent schema setup, consistent with existing workers. No new credentials are required. The existing GSW meeting credentials are used only when the owner explicitly enables generated video links.

The required local `npm run db:migrate --workspace apps/api` was attempted; the configured local PostgreSQL connection is unavailable. The exact schema is applied twice in the PGlite integration test to verify syntax, constraints and idempotence. Production migration and real mailbox/event/email acceptance still require deployment verification.

Validation covers slot policy, duration rules, date exclusions, advance notice, DST gaps and all-day DST boundaries; manual/auto approval, expiry, immutable retries and cross-link conflicts; tenant denial; calendar failure states; private public metadata; outbound queue staging/idempotence; and UTF-8/ICS escaping. Run API/web typechecks, API tests and the production web build. A local browser acceptance attempt was blocked by the environment's Chromium process/socket restriction, so desktop/mobile interactive acceptance remains outstanding.
