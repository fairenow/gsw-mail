# GSW Mail performance pass

This pass targets perceived and actual latency in the mail UI without changing the established Stalwart/OAuth/Neon architecture.

## Goals

- Folder switches should feel immediate after first load.
- Opening a recently loaded message should be effectively instant.
- Read/star/archive/trash actions should update the UI optimistically and reconcile in the background.
- Avoid duplicate account authorization/database work per mail request.
- Avoid unnecessary JMAP mailbox discovery before every folder query.
- Reuse the existing user-scoped JMAP engine/session caches.

## Current hot paths

- `/mail/messages` currently authorizes once in the route and again inside `getUserEngine()`.
- `/mail/mailboxes/stats`, message detail, read/star/move/archive/trash/destroy routes have the same duplicate authorization pattern.
- `/mail/messages` resolves/list mailboxes before calling `listMessages`, even though the engine can resolve the mailbox for the query.
- The web client waits for network responses before replacing folder contents and message bodies, and it refreshes mailbox stats after routine actions.

## Delivery strategy

1. Remove redundant route-level authorization calls where `getUserEngine()` already performs the same permission check.
2. Remove the redundant mailbox-list round trip from message listing.
3. Add short-lived client caches/in-flight request deduplication for folder lists, mailbox stats, and message bodies.
4. Render cached values immediately and revalidate in the background.
5. Keep mutations optimistic and invalidate affected cache keys instead of doing full blocking refreshes.
6. Add timing telemetry around JMAP/session/token acquisition so remaining latency can be isolated by layer.
