import { additionalAdminTools } from "./adminTools.js";
/** Minimal read-only bootstrap tools, independent of mailbox account selection. */
export const mcpBootstrapTools = [
  ...additionalAdminTools,
  {
    name: "get_current_user",
    description: "Identify the authenticated GSW user without accessing any mailbox.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    requiredScopes: ["openid"],
  },
  {
    name: "list_capabilities",
    description: "Paginated inventory of tools for this connection type with required scopes, risk, OAuth gaps, and write availability. Invoke administration tools by their listed names; mailbox registry tools also support invoke_tool. Authorization is checked on every call.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", maxLength: 200, description: "Optional tool name, description, or OAuth scope filter." },
        offset: { type: "integer", minimum: 0, description: "Pagination offset; defaults to 0." },
        limit: { type: "integer", minimum: 1, maximum: 100, description: "Maximum entries per page; defaults to 50." },
      },
      additionalProperties: false,
    },
    requiredScopes: ["openid"],
  },
  {
    name: "prepare_action",
    description: "Prepare an email draft for exact-content review in GSW Mail Security settings. Creates a pending approval request only; does NOT create or send email. Currently supports mail.create_draft.",
    inputSchema: {
      type: "object",
      properties: {
        accountId: { type: "string", format: "uuid", description: "Mailbox account UUID" },
        toolName: { type: "string", enum: ["mail.create_draft"] },
        arguments: {
          type: "object",
          properties: {
            to: { type: "array", items: { type: "string", format: "email" }, minItems: 1, maxItems: 100 },
            cc: { type: "array", items: { type: "string", format: "email" }, maxItems: 100 },
            bcc: { type: "array", items: { type: "string", format: "email" }, maxItems: 100 },
            subject: { type: "string", maxLength: 998 },
            textBody: { type: "string", maxLength: 200000 },
            htmlBody: { type: "string", maxLength: 500000 },
            replyTo: { type: "string", format: "email" },
            inReplyTo: { type: "string", maxLength: 2000 },
            references: { type: "string", maxLength: 8000 },
          },
          required: ["to"],
          additionalProperties: false,
        },
      },
      required: ["accountId", "toolName", "arguments"],
      additionalProperties: false,
    },
    requiredScopes: ["mail.write"],
  },
  {
    name: "grant_my_scopes",
    description: "Owner-only: explicitly grant selected GSW AI permissions to your own mailbox. Requires enabled owner write-test mode, account ownership, OAuth consent for each scope, and confirmGrant=true. Does not send email.",
    inputSchema: {
      type: "object",
      properties: {
        accountId: { type: "string", format: "uuid" },
        scopes: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 100 },
        confirmGrant: { type: "boolean", description: "Confirm that these permissions should be activated for your mailbox." },
      },
      required: ["accountId", "scopes", "confirmGrant"],
      additionalProperties: false,
    },
    requiredScopes: ["openid"],
  },
  {
    name: "list_admin_workspaces",
    description: "List workspaces where the authenticated GSW user has an active owner or administrator membership. Does not require a mailbox.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    requiredScopes: ["workspace.read"],
  },
  {
    name: "list_admin_domains",
    description: "List domain metadata and DNS verification status within a workspace the authenticated user administers. Does not require a mailbox.",
    inputSchema: {
      type: "object",
      properties: {
        organizationId: { type: "string", format: "uuid", description: "Workspace UUID from list_admin_workspaces" },
      },
      required: ["organizationId"],
      additionalProperties: false,
    },
    requiredScopes: ["domain.read"],
  },
  {
    name: "list_admin_mailboxes",
    description: "List mailbox metadata for a specific verified or pending mail domain in a workspace administered by the caller. Does not grant access to messages.",
    inputSchema: {
      type: "object",
      properties: {
        organizationId: { type: "string", format: "uuid" },
        domainId: { type: "string", format: "uuid" },
      },
      required: ["organizationId", "domainId"],
      additionalProperties: false,
    },
    requiredScopes: ["mailbox_admin.read"],
  },
  {
    name: "create_admin_mailbox",
    description: "Create a mailbox on a verified domain within an authorized workspace. Requires a fresh requestId, explicit confirmation, mailbox_admin.write OAuth consent and separately enabled administrative writes. Does not grant message access.",
    inputSchema: {
      type: "object",
      properties: {
        organizationId: { type: "string", format: "uuid" },
        domainId: { type: "string", format: "uuid" },
        localPart: { type: "string", maxLength: 128, pattern: "^[a-zA-Z0-9._%+-]+$" },
        displayName: { type: "string", maxLength: 200 },
        requestId: { type: "string", format: "uuid" },
        confirmExternal: { type: "boolean" },
      },
      required: ["organizationId", "domainId", "localPart", "requestId", "confirmExternal"],
      additionalProperties: false,
    },
    requiredScopes: ["mailbox_admin.write"],
  },
  {
    name: "list_accounts",
    description: "List GSW Mail accounts this user is permitted to read. Use an accountId from this list with mail tools.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    requiredScopes: ["mail.read"],
  },
] as const;
