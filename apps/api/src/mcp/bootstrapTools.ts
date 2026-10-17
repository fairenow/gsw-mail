/** Minimal read-only bootstrap tools, independent of mailbox account selection. */
export const mcpBootstrapTools = [
  {
    name: "get_current_user",
    description: "Identify the authenticated GSW user without accessing any mailbox.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    requiredScopes: ["openid"],
  },
  {
    name: "list_capabilities",
    description: "Inspect the GSW Mail MCP capability catalog, including backend tools not yet exposed for execution. Reports OAuth scope gaps and whether write transport is disabled. Use this to discover available primitives without assuming an advertised tool is callable.",
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
    description: "Prepare a proposed GSW Mail action for first-party review. Currently supports mail.create_draft only. Validates current OAuth and mailbox permissions and stores a pending approval request; does NOT create or send an email. The exact draft body is not stored for review yet, and write execution remains disabled.",
    inputSchema: {
      type: "object",
      properties: {
        accountId: { type: "string", description: "GSW mailbox account UUID" },
        toolName: { type: "string", enum: ["mail.create_draft"] },
        arguments: {
          type: "object",
          properties: {
            to: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 100 },
            cc: { type: "array", items: { type: "string" } },
            bcc: { type: "array", items: { type: "string" } },
            subject: { type: "string" },
            textBody: { type: "string" },
            htmlBody: { type: "string" },
            replyTo: { type: "string" },
            inReplyTo: { type: "string" },
            references: { type: "string" },
          },
          required: ["to"],
          additionalProperties: false,
        },
      },
      required: ["accountId", "toolName", "arguments"],
      additionalProperties: false,
    },
    requiredScopes: ["openid"],
  },
  {
    name: "list_accounts",
    description: "List GSW Mail accounts this user is permitted to read. Use an accountId from this list with mail tools.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    requiredScopes: ["mail.read"],
  },
] as const;
