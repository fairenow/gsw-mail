/** Minimal read-only bootstrap tools, independent of mailbox account selection. */
export const mcpBootstrapTools = [
  {
    name: "get_current_user",
    description: "Identify the authenticated GSW user without accessing any mailbox.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    requiredScopes: ["openid"],
  },
  {
    name: "list_accounts",
    description: "List GSW Mail accounts this user is permitted to read. Use an accountId from this list with mail tools.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    requiredScopes: ["mail.read"],
  },
] as const;
