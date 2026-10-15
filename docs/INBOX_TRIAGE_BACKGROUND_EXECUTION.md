# Inbox triage: unattended execution authorization boundary

## Current safe behavior
PR #146 supports checkpointed, authenticated mail reads. `mail.triage_scan_step` reads up to 32 pages within a 12-second budget, storing mailbox-scoped progress in PostgreSQL after each page. `mail.triage` only returns results when its progress record says the scan is done. It does **not** run as an unattended Railway worker.

## Why simply invoking the tool from a background timer is unsafe
`getUserEngine` requires a user-specific mailbox identity and live authenticated OAuth context. The general task runner explicitly does not assume live mailbox/JMAP access. Durable job records must never contain HTTP session cookies, bearer tokens or refresh secrets. Using a service-level mailbox superuser would bypass the mailbox authorization model.

## Production architecture for true unattended scanning
1. Introduce an explicit, revocable background-mail-read grant separate from ordinary interactive `mail.read`. Validate account membership and grant state every time a job is claimed and after each page.
2. Provision a scoped OAuth/offline credential through an approved provider flow, encrypted by a dedicated secrets service, bound to the specific user and mailbox. Store a reference to the credential in job metadata, never raw credentials. Recheck token expiry and revocation. If the identity provider cannot support this safely, keep scans interactive.
3. Create a dedicated job table: `id`, `user_id`, `account_id`, `status`, `lease_owner`, `lease_expires_at`, `next_run_at`, `attempts`, `last_error_category`, `created_at`, `updated_at`. Claim with `FOR UPDATE SKIP LOCKED`. Do not share the general chat execution queue until its auth contract fits this workload.
4. Have each worker claim only one lease, read a small bounded group of pages, save the snapshot checkpoint transactionally with a monotonic version, then release/requeue. Expired leases can retry idempotently because checkpoints are fenced.
5. Track mailbox state changes. Offset pagination is vulnerable to inserts/deletes during scans. Prefer a frozen JMAP query snapshot or stable cursor/anchor and validate state before declaring full coverage. If state changes, reconcile or mark coverage incomplete.
6. Report `scanning`, `awaiting_authorization`, `completed`, or `incomplete` in task APIs and chat. Only produce confirmed totals after complete Inbox and Sent coverage. Candidate threads still require semantic body review.
7. Add tests for concurrent workers, token revocation, lost leases, crash recovery, mailbox mutation during pagination, and 2,859+ mailboxes without exposing messages across user/account boundaries.

## Current acceptance boundaries
- Scan checkpoints persist across process restarts; running the scan requires an authenticated user call.
- The stored report is metadata-based and candidates are not verified human reply obligations.
- Before enabling unattended scans, verify encryption-at-rest, minimal retention, deletion on user revocation, execution metrics, and data isolation.
