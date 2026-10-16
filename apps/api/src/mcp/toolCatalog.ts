/**
 * Public, declarative contract for the future remote GSW Mail MCP server.
 *
 * This registry is intentionally NOT registered as an unauthenticated endpoint.
 * MCP transport and OAuth resource authorization must be implemented and tested
 * before making these tools discoverable to remote callers.
 */
export type McpToolDefinition = {
  name: string;
  description: string;
  scope: string;
  approval: "none" | "required";
  phase: 1 | 2 | 3;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties: false;
  };
};

export const GSW_MCP_TOOLS = [
  {
    name: "mail_search",
    description: "Search messages in mailboxes that the signed-in GSW user is authorized to read.",
    scope: "mail.read",
    approval: "none",
    phase: 1,
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", minLength: 1, maxLength: 500 },
        mailboxId: { type: "string", maxLength: 128 },
        limit: { type: "integer", minimum: 1, maximum: 50, default: 20 },
        cursor: { type: "string", maxLength: 1024 }
      },
      required: ["query"],
      additionalProperties: false
    }
  },
  {
    name: "mail_get_thread",
    description: "Read a thread after checking the caller's mailbox authorization.",
    scope: "mail.read",
    approval: "none",
    phase: 1,
    inputSchema: {
      type: "object",
      properties: { threadId: { type: "string", minLength: 1, maxLength: 256 } },
      required: ["threadId"],
      additionalProperties: false
    }
  },
  {
    name: "contacts_search",
    description: "Find saved GSW contacts visible to the signed-in user.",
    scope: "contacts.read",
    approval: "none",
    phase: 1,
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", minLength: 1, maxLength: 200 },
        limit: { type: "integer", minimum: 1, maximum: 50, default: 20 }
      },
      required: ["query"],
      additionalProperties: false
    }
  },
  {
    name: "calendar_list_events",
    description: "List calendar events for a bounded time interval.",
    scope: "calendar.read",
    approval: "none",
    phase: 1,
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", format: "date-time" },
        to: { type: "string", format: "date-time" }
      },
      required: ["from", "to"],
      additionalProperties: false
    }
  },
  {
    name: "files_search",
    description: "Search file metadata and authorized file content.",
    scope: "files.read",
    approval: "none",
    phase: 1,
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", minLength: 1, maxLength: 300 },
        limit: { type: "integer", minimum: 1, maximum: 50, default: 20 }
      },
      required: ["query"],
      additionalProperties: false
    }
  },
  {
    name: "mail_create_draft",
    description: "Create a draft without sending or scheduling delivery.",
    scope: "mail.draft",
    approval: "none",
    phase: 2,
    inputSchema: {
      type: "object",
      properties: {
        mailboxId: { type: "string", minLength: 1, maxLength: 128 },
        to: { type: "array", items: { type: "string", format: "email" }, minItems: 1, maxItems: 50 },
        subject: { type: "string", maxLength: 998 },
        text: { type: "string", maxLength: 100000 }
      },
      required: ["mailboxId", "to", "subject", "text"],
      additionalProperties: false
    }
  },
  {
    name: "mail_send_draft",
    description: "Send an existing draft with explicit confirmation and an idempotency key.",
    scope: "mail.send",
    approval: "required",
    phase: 2,
    inputSchema: {
      type: "object",
      properties: {
        draftId: { type: "string", minLength: 1, maxLength: 128 },
        idempotencyKey: { type: "string", minLength: 8, maxLength: 128 }
      },
      required: ["draftId", "idempotencyKey"],
      additionalProperties: false
    }
  }
] as const satisfies readonly McpToolDefinition[];

export function toolsAvailableForScopes(scopes: ReadonlySet<string>, maxPhase: 1 | 2 | 3 = 1): McpToolDefinition[] {
  return GSW_MCP_TOOLS.filter(tool => tool.phase <= maxPhase && scopes.has(tool.scope)).map(tool => ({ ...tool }));
}
