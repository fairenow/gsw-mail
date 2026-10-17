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
    description: "Paginated inventory of every registered GSW Mail tool with required scopes, risk, OAuth gaps, and write-mode availability. All registered tools can be invoked through invoke_tool; authorization and test-mode restrictions are checked at call time.",
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
    name: "list_accounts",
    description: "List GSW Mail accounts this user is permitted to read. Use an accountId from this list with mail tools.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    requiredScopes: ["mail.read"],
  },
] as const;
