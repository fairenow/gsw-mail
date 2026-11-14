# GSW Mail private meetings — implementation contract

First web milestone: a paid Mail organizer creates a private meeting inside the calendar composer, includes the ordinary join URL in invitations, and opens a single-use host handoff into a focused Bible Study web room. Guests enter a waiting room without an account. Existing community ownership, public streaming and social output remain unchanged.

Ownership is by authenticated partner workspace and immutable Mail product user ID, never email matching or hidden communities. Partner meetings have separate tables and token paths, so their session tokens cannot authorize community broadcasts or social destinations. Recording and scripture production are not included.

Mail verifies send access to the mailbox, derives its organization server-side, and checks an active paid workspace subscription or the existing operator exemption. Free-only workspaces do not receive the entitlement. Feature switches default off. Mail sends a server-only integration credential to the Convex HTTP endpoint over HTTPS; it never enters browser bundles. The service accepts only meeting operations and bounded payloads.

Creation is idempotent per workspace and composer/event key. A shared URL has no host powers. Joining as organizer requires a fresh Mail-authenticated launch call, a 120-second single-use handoff ticket, and an exchange for a meeting-scoped host session. Ticket fragments are cleared immediately before exchange. Names are display-only. Host and guest sessions are hashed in storage and bound to one meeting. No Bible user or community membership is created.

The meeting does not start on link creation. Host start is entitlement-time-limited and creates a deterministic LiveKit room with a participant limit. An absolute session deadline schedules room cleanup; short guest token TTLs are bounded by that deadline. Guests get no media credentials before admission. End/cancel closes the provider room and stops subsequent token issuance. Provider failure remains visible and retryable.

Calendar uses its existing meetingLink field and engine abstraction. New meeting IDs are allocated before a create retry. No mailbox or event storage migration is required. Initial recurring meetings and automatic update/cancel synchronization are intentionally deferred; a canceled calendar event must also be canceled through the meeting controls until lifecycle synchronization ships. Native handoff is a later phase; this milestone uses web links on mobile.

Release gates: service auth, free/paid billing boundaries, cross-workspace and cross-organizer isolation, idempotency, one-time handoff, guest admission, host end, limits and expiry tests; typechecks in both apps and canonical backend; real two-browser camera/microphone/share/chat check; configure staging keys and enable flags only after coordinated deployment.

Configuration and exact validation results are recorded alongside the completed code before review. No production activation or secrets are changed automatically.

## Implemented web milestone

The HTTP service supports create and launch. Private web rooms live at `/meet/:meetingId`, deliberately separate from community `/live` rooms. Initial limits are 10 total admitted people, 60 minutes from host start, and one starting/active meeting per organizer. Different organizers can meet concurrently. These limits are enforced in transactional mutations and provider room creation.

Calendar events retain an ordinary, credential-free joinUrl. Organizer Join in Mail launches a new window, authorizes server-side, and exchanges a two-minute ticket. A direct invitation also offers Continue as organizer through GSW Mail, returning through `/calendar?hostMeeting=...`; existing Mail sign-in and mailbox selection are reused. The returned URL must match the configured Bible origin, exact meeting ID and expected ticket fragment. A non-organizer receives guest access only. A guest gets no LiveKit token until admitted. Media starts with devices off.

End/removal stops further token issuance and revokes provider tokens with an explicit cutoff. End and removal have durable scheduled cleanup retries; the session deadline schedules closure independently. LiveKit Cloud is required for provider token revocation. Credentials have no room-admin, room-create, or room-record grants. No public/community/social endpoint accepts partner meeting/session IDs as authority.

Recording, native host handoff, recurring occurrences, usage metering, host reassignment, and automatic synchronization of event edits/deletion are deferred. Event title/time are captured when creating the video link; changing the calendar does not yet modify or cancel the remote meeting. Unused composer links hold metadata only, never idle media rooms. An event deleted in Mail does not invalidate its video link in this milestone; the organizer can end that room from the meeting page. Do not market full calendar lifecycle synchronization yet.

## Configuration

| Setting | Location | Value/purpose |
| --- | --- | --- |
| `BIBLE_MEETINGS_ENABLED` | GSW Mail API runtime | `true` only after staging acceptance; defaults off |
| `BIBLE_MEETINGS_API_URL` | GSW Mail API runtime | `https://<deployment>.convex.site/integrations/gsw-mail/meetings` |
| `BIBLE_MEETINGS_WEB_ORIGIN` | GSW Mail API runtime | `https://bible.guidedstepswellness.com` |
| `BIBLE_MEETINGS_SERVICE_SECRET` | GSW Mail API runtime | New high-entropy server-only credential, at least 32 characters |
| `GSW_MEETINGS_ENABLED` | Bible Study Convex environment | `true` only after staging acceptance; defaults off |
| `GSW_MEETINGS_SERVICE_SECRET` | Bible Study Convex environment | Exactly the same credential as the Mail service secret |
| `GSW_MAIL_WEB_ORIGIN` | Bible Study web runtime | Actual GSW Mail web origin, e.g. `https://mail.guidedstepswellness.com`; enables organizer sign-in return |
| `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | Bible Study Convex environment | Reuse the existing LiveKit Cloud project credentials |

No client/public secret, new Stripe product, or new Mail database migration is introduced. Mail currently treats an unexpired active/trialing paid subscription (mailbox or AI quantity above zero) or an existing explicit operator-exempt workspace as entitled. A workspace with only its free mailbox is not entitled. Past-due/unpaid/canceled subscriptions cannot create or launch. Start must occur within five minutes of the latest entitled host launch; otherwise reopen from Mail. Existing running meetings may finish within their deadline.

Deploy the canonical Convex schema/index/functions and the Bible web route, then the Mail API and web changes. Set the two identical secrets and origins while both switches are off. Enable the switches on staging first, and only then on production after acceptance. Preserve existing active meetings before using a flag as a rollback; scheduled provider cleanup does not depend on the feature flag.

## Validation performed

- 12 Convex/LiveKit tests pass using the actual schema, `convex-test`, and mocked provider calls. They cover identity isolation, entitlement timing, idempotency, handoff expiry/replay, admission/limits, organizer concurrency, grants, and revocation/closure ordering.
- 8 Mail Node tests pass for billing boundaries, mailbox-derived identity, request validation, transport/redirect safety, and join/launch URL recognition. They use the existing Node/tsx runner; no new test dependency is required in Mail.
- Full Mail web `npm run typecheck` passes.
- Focused Mail API typecheck uses the repository's strict compiler settings and real auth/schema dependencies; it passes. Full API application typecheck/build was not run from this partial source checkout.
- Focused canonical backend typecheck against the generated data-model/schema passes. Changed JSX and HTTP registration syntax checks pass. Full Next production build and Convex deployment were not run.
- Three DOM interaction checks bundle the actual calendar/meeting components with simulated providers: generate/attach a normal invitation link, clear/exchange a host ticket without starting media, and show accountless guest entry with organizer return.
- Chromium was attempted, but the execution environment rejects its singleton socket (`socket() failed: Operation not permitted`). Pixel layout, popup behavior, camera/microphone/share/chat across real browsers and live billing/provider acceptance remain pending.

The temporary test environment used a peer-compatible Convex 1.48 with convex-test 0.0.69; the backend was also initially checked with Convex 1.42.3. No repository dependency or lockfile changes are included.

Before enabling production: create from a paid workspace, save/email the event, join as host from Mail and from the ordinary link's organizer button, admit an accountless guest in a second browser, enable audio/video/share, mute/remove a guest, end the meeting, verify rejoin refusal and deadline cleanup, and confirm free/foreign-workspace denial. Verify `/meet` remains a usable web fallback on installed mobile devices before native handoff is added. Audit cleanup failures in Convex logs.
