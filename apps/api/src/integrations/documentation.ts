export const mailboxApiDocumentation = `GSW Mailbox API

Base URL: /integrations/v1 on your GSW API host.
Authenticate: Authorization: Bearer YOUR_SERVER_KEY
Keep this key on your server. It grants full access to one mailbox, never admin access.

GET /connection: mailbox binding, test/live mode and connection information.
GET /capabilities: every available mailbox operation, its JSON input schema and whether it changes data.
POST /operations: {"name":"mail.list_recent","arguments":{"limit":10}}
For writes, include Idempotency-Key: a-stable-unique-action-id
Reads return the existing mailbox service result. Repeating a write key returns its execution status and resource reference; it does not execute the action again. Changed arguments with the same key are rejected. A reserved operation with no completion must be investigated before another write.

POST /emails: {"senderId":"MAILBOX_UUID","to":["visitor@example.org"],"subject":"Thank you","text":"We received your inquiry."}
Include Idempotency-Key. Returns 202 only after persistence. Poll GET /emails/ID.

POST /ai/chat: {"messages":[{"role":"user","content":"Draft a warm welcome message."}]}
Uses the connected mailbox's AI model selection, including Kimi when selected in that mailbox's AI settings. This endpoint generates text; use mailbox operations for explicit actions. Provider reasoning is not returned.

Test connections simulate operations and AI calls without executing them or sending mail.
Live connections perform real actions. No per-tool scopes or recipient allowlists are required.
Mailbox operations reuse the existing product services; discover their current coverage and schemas with GET /capabilities. Do not infer that every product UI feature is already a registry operation.

Full-mailbox keys cannot manage workspaces, domains/DNS, mailbox provisioning, billing, account credentials or API keys. Current workspace owners/admins manage connections and keys in Control Center > API.

Pause or revoke to stop subsequent authorization. An already accepted external action cannot be recalled. Created schedules/automations have their own lifecycle; pause/delete those records separately when retiring a workflow.

Keys expire; rotate before expiry. The service may require reconnecting the mailbox when its underlying authorization expires or is revoked. Admin login is separate from mailbox login.

Errors: {"error":{"code":"...","requestId":"...","retryable":false}}
429 includes Retry-After. Retrying mail submission requires the same key and payload.
Submitted email is not proof of inbox delivery. An uncertain submission requires reconciliation before a new send.
`;
