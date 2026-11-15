# GSW Mail private web meetings

GSW Mail schedules and purchases access; the Bible Study App hosts private LiveKit meeting rooms. There is no community ownership grant, public discovery, social output or recording.

## User flow

1. Generate in the event modal inserts a stable invitation URL. Save stores it through MailEngine virtualLocations and includes it in invitations.
2. Open the saved event and select Host meeting. GSW Mail verifies mailbox permissions and paid/operator access, then issues a single-use 60-second handoff.
3. The Bible web exchange sets a meeting-scoped Secure HttpOnly cookie. Select Start meeting, then Join meeting. Devices start off.
4. Guests use the ordinary URL, enter their name and request admission. The organizer admits, mutes or removes them. Camera, microphone, screen share, chat and gallery use the room controls.
5. End for everyone closes the occurrence and provider room. A subsequent start requires a fresh organizer handoff.

## Access and limits

Creating links and issuing host handoffs require current paid access. The two known founder accounts are also allowed when authenticated, active, and owners of a workspace with the existing founder_operator_exception grant. Free mailboxes and unrelated exemptions do not qualify.

Initial limits: 10 participants including the host, 60 minutes per occurrence, one active occurrence per workspace. New starts require the handoff's billing assertion to remain fresh. Existing sessions can reconnect until their reserved duration ends. Expired host authorization instructs the organizer to open Host meeting again.

## Service configuration

Railway GSW Mail: GSW_MEETINGS_ENABLED, GSW_MEETINGS_SIGNING_SECRET, GSW_MEETINGS_API_URL (production Convex .site origin), GSW_MEETINGS_WEB_ORIGIN.

Convex: GSW_MEETINGS_ENABLED, the same dedicated GSW_MEETINGS_SIGNING_SECRET, GSW_MEETINGS_WEB_ORIGIN, and existing LIVEKIT_URL/API_KEY/API_SECRET.

Bible Next.js: GSW_MEETINGS_ENABLED, GSW_MEETINGS_API_URL, GSW_MEETINGS_WEB_ORIGIN, GSW_MEETINGS_MAIL_ORIGIN. The web proxy does not need the signing secret. Never prefix secrets with NEXT_PUBLIC_ or VITE_.

## Backend contract and lifecycle

Service assertions bind exact request bytes, organizer, workspace, operation and expiry. Each request ID is consumed atomically; business retries retain the event UUID. Create, handoff, update and cancel are distinct operations. The initial create payload is stable across retries; a subsequent explicit update changes title/timezone metadata.

Partner links, occurrences, guests and host sessions are separate from community streams. Guest credentials stay in HttpOnly cookies. No media token is issued before host admission. Signed media grants are room-only and short-lived, with no roomAdmin or roomRecord permission. Guest admissions bind to one occurrence and never carry into another.

Calendar edits synchronize metadata before the engine save. Removing/deleting an organizer-owned meeting link cancels future access; active occurrences must end first. Non-organizer copies do not control the original room. A failed calendar save can leave a never-started link or updated metadata; retries remain safe and no media room starts as a side effect of saving.

Timed cleanup and a recovery cron end expired occurrences, retry provider deletion and clean expired credentials. The existing verified LiveKit webhook routes partner room events to participant authorization reconciliation.

## Validation

Use backend isolation/admission/concurrency/cancellation/token-policy tests, web proxy cookie/CSRF tests, signed-client tests and operator/timezone tests. Run GSW API and web typechecks/build, the full API suite and the canonical Convex backend typecheck. Verify one real organizer/guest session after deployment with devices off before checking physical camera/audio sharing on target browsers.
