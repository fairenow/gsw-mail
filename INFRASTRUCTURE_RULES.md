# GSW Mail Infrastructure Rules

This document records architectural invariants that must be preserved across API, web, auth, onboarding, and mailbox-management changes.

## Admin identities and mailbox identities are separate

The workspace owner/admin account is a **control-plane identity only**. It exists to own and administer the workspace.

A workspace owner/admin may:

- create and manage the workspace
- add and verify domains
- create mailboxes on verified domains
- manage users and mailbox access
- recover or reset mailbox credentials through the admin recovery flow

A workspace owner/admin **must not automatically become a mailbox** and must not receive a mailbox merely because they own or administer the workspace.

## Mailboxes belong to verified domains

Actual mailbox identities are created separately from the Admin Control Center and must use a verified workspace domain.

Examples:

```text
Workspace admin / recovery identity
  admin@gmail.com

Verified workspace domain
  fairenow.com

Separate mailbox identities
  ramon@fairenow.com
  support@fairenow.com
  billing@fairenow.com
```

The admin identity above remains separate from all three mailbox identities.

## Mailbox creation rule

Creating a mailbox must create or attach a **dedicated mailbox user identity** for that mailbox address.

Mailbox creation must not:

- reuse the currently signed-in workspace owner/admin as the mailbox user
- silently assign the admin's recovery email as a mailbox address
- make workspace ownership imply mailbox ownership
- create a mailbox before its domain is verified

The backend must reject attempts to use a workspace owner/admin identity as the direct mailbox identity for a newly created mailbox.

## Authentication separation

The admin account and mailbox accounts have different authentication responsibilities:

- **Admin account:** authenticates to the control plane and manages workspace infrastructure.
- **Mailbox account:** authenticates to mail using the mailbox address and its own password/credential.

Mailbox password setup/reset may be authorized through a verified workspace admin recovery flow, but the resulting mailbox credential belongs to the mailbox identity, not to the admin identity.

## Onboarding boundary

Workspace onboarding should progress in this order:

```text
Admin account
  -> Workspace
  -> Domain
  -> DNS verification
  -> Admin Control Center
  -> Create first mailbox on verified domain
  -> Set up mailbox login
```

The transition to "first mailbox" does **not** mean creating a mailbox for the admin. It means allowing the admin to create the first separate mailbox identity from the Control Center.

## Why this rule exists

This separation protects recovery, authorization, and tenancy boundaries:

- losing access to a mailbox must not remove access to the workspace control plane
- the workspace can manage multiple independent mailbox identities
- admin ownership is not confused with mailbox ownership
- recovery can remain available through a non-mailbox admin identity
- future admins can manage mailboxes without becoming mail users themselves

## Implementation invariant

Treat this as a hard infrastructure rule, not a UI preference.

Any change touching `users`, `organizationMemberships`, `emailAccounts`, `mailAccountMemberships`, mailbox authentication, account context resolution, onboarding, or Control Center mailbox creation must preserve this separation.
