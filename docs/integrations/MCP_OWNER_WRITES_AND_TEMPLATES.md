# MCP owner mailbox writes and template consent

The MCP transport is conservative by default. Read actions require OAuth consent,
live account membership and GSW AI permission grants. Write actions are disabled
unless an authenticated, explicitly named mailbox owner is enabled.

## Production owner-only write opt-in

Configure the API service with both environment variables:

```dotenv
GSW_MCP_OWNER_WRITES_ENABLED=true
GSW_MCP_OWNER_WRITES_USER_ID=<authenticated get_current_user userId>
```

Use the **userId** returned by the authorized MCP `get_current_user`
call, not the mailbox `accountId`, OAuth `clientId`, or an email address.
Do not commit environment-specific IDs or credentials.

The older `GSW_MCP_WRITE_TEST_ENABLED` and
`GSW_MCP_WRITE_TEST_USER_ID` pair remains supported for compatibility.
Do not enable the switch for a broadly shared identity.

Enabled does **not** mean unrestricted:
- Every tool still requires its declared OAuth scopes, existing GSW AI
  permission grants and live mailbox permissions.
- Writes require a fresh UUID `requestId` and durable idempotency.
- External effects such as sending an email require `confirmExternal=true`.
- When `GSW_MCP_REQUIRE_PERSISTED_APPROVAL=true`, a matching,
  unexpired GSW approval is also mandatory.
- Administrator and mailbox tool sets remain separate.

## Recovering missing mailbox permissions

If a template call returns an OAuth `insufficient_scope` challenge,
the external OAuth client must reauthorize with `templates.read`
(and `templates.write` for editing/selecting templates). Likewise
use `mail.read`, `mail.write`, and `mail.send` as appropriate
for message search, drafting and delivery.

OAuth scope consent **does not itself grant** a GSW AI permission.
The authenticated owner must review/enable account-level capabilities
through GSW permissions or invoke `grant_my_scopes` with
`confirmGrant=true` after the owner-only switch is enabled.
The tool only grants scopes present in that client's OAuth consent
and requires verified mailbox ownership.

## Deployment acceptance

1. Deploy the updated API from `main`.
2. Configure the two owner-write variables on the deployed API service.
3. Reconnect the target mailbox and consent to template scopes.
4. Check `get_current_user` for the exact user ID and
   `list_capabilities` for OAuth gaps/write status.
5. Enable the target mailbox's GSW AI scopes (including `mail.read`,
   `mail.write`, `mail.send`, `templates.read` and optionally
   `templates.write`) through the owner's permitted settings.
6. Read templates and Sent, create one draft, review its branding and
   HTML link, then explicitly confirm one real send.
7. Verify the sent copy and idempotency before attempting any outreach batch.

No code deployment or OAuth reconnect silently grants permissions to a
different user. Existing live connected clients may require a refreshed
OAuth grant after deployment.
