# GSW Mail external MCP OAuth architecture and acceptance checks

Sources reviewed (2026-10-19):
- https://developers.openai.com/plugins/build/auth
- https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization
- https://better-auth.com/docs/plugins/oauth-provider
- https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt

## Trust boundaries

1. ChatGPT is an external OAuth client. It receives resource-bound authorization for the GSW Mail MCP server using an authorization-code flow with S256 PKCE. MCP verifies issuer, audience, expiry, scopes, identity and mailbox ACL. Publish RFC 9728 protected resource metadata and authorization-server discovery. Do not forward external MCP bearers to Stalwart.
2. Website authentication uses a first-party Better Auth browser session. Session reuse does not imply missing persistence; audit sign-in events separately if every successful login must be recorded. Do not count sessions as login events.
3. Stalwart mailbox access uses an independently signed and verified first-party mailbox credential, or a separately reviewed delegated-token exchange. Refresh grants must match the authenticated user, trusted first-party OAuth client, revocation and expiry criteria. Never fall back to administrative mailbox credentials.

## Regression and targeted change

Neon contains a first-party GSW Mail Mobile refresh grant for the tested identity, but MCP Inbox reports no_persisted_credential / mailbox_session_required. Previously a stored-access-token lookup exception prevented a later refresh attempt. This PR isolates those lookups and reports privacy-safe stages. This remains a suspected failure path, not a proven root cause.

## Staging acceptance

- Confirm ChatGPT MCP resource metadata, OAuth server metadata, exact audience/resource, PKCE S256, and correct consented scopes.
- Confirm Better Auth web sessions and sign-in audit events separately.
- Check stored-token lookup, refresh candidate lookup, refresh HTTP exchange, JWT issuer/audience/subject/email validation, and Stalwart JMAP read, without logging secrets, token claims, mailbox identifiers, or email contents.
- Verify same Neon branch is used by Railway and diagnostics.
- Test refresh rotation and stale grant rejection; Better Auth rotates refresh credentials. Avoid reusing revoked refresh grants.
- With a real consented user, close the browser and read selected Inbox through MCP; repeat after access-token expiry and for revoked/cross-account grants.
- Require CI typecheck and tests, then staging E2E, before production merge. Do not call the regression fixed until a real Inbox read passes.
