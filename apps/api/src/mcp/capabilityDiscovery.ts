import type { AgentToolDefinition } from "../ai/tools/types.js";

export interface McpCapabilityEntry {
  name: string;
  description: string;
  requiredScopes: string[];
  risk: "read" | "reversible_write" | "external";
  status: "available_for_read" | "available_for_test_write" | "available_for_approved_write" | "oauth_scope_missing" | "write_transport_disabled";
  missingScopes: string[];
}

/**
 * Discover the backend's tool inventory without implying write actions are
 * callable. Actual read authorization is still checked per invocation.
 */
export function discoverMcpCapabilities(
  tools: readonly AgentToolDefinition[],
  oauthScopes: ReadonlySet<string>,
  options: { query?: string; offset?: number; limit?: number; writeTestEnabled?: boolean; publicWriteEnabled?: boolean } = {},
) {
  const query = (options.query ?? "").trim().toLowerCase();
  const offset = options.offset ?? 0;
  const limit = options.limit ?? 50;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 10000) throw new Error("invalid offset");
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error("limit must be between 1 and 100");
  if (query.length > 200) throw new Error("query too long");
  const all: McpCapabilityEntry[] = tools
    .filter(tool => !query || `${tool.name} ${tool.description} ${tool.requiredScopes.join(" ")}`.toLowerCase().includes(query))
    .map(tool => {
      const missingScopes = tool.requiredScopes.filter(scope => !oauthScopes.has(scope));
      return {
        name: tool.name.replaceAll(".", "__"),
        description: tool.description,
        requiredScopes: [...tool.requiredScopes],
        risk: tool.risk,
        status: missingScopes.length > 0
          ? "oauth_scope_missing" as const
          : tool.risk === "read"
            ? "available_for_read" as const
            : options.writeTestEnabled ? "available_for_test_write" as const : options.publicWriteEnabled && tool.name === "mail.create_draft" && tool.risk === "reversible_write" ? "available_for_approved_write" as const : "write_transport_disabled" as const,
        missingScopes,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  return {
    total: all.length,
    offset,
    nextOffset: offset + limit < all.length ? offset + limit : null,
    capabilities: all.slice(offset, offset + limit),
    note: options.publicWriteEnabled && !options.writeTestEnabled
      ? "Limited public draft-creation rollout: an authenticated first-party persisted approval is required for each write, alongside OAuth, GSW grants and mailbox ACL. All other writes remain disabled."
      : options.writeTestEnabled
      ? "Owner-only write test mode is enabled. Every call requires live GSW permissions and mailbox access, a unique requestId, and confirmExternal=true for external effects. Actions are real, not dry runs."
      : "Read tools require live GSW grants and account access. Write tools are disabled unless the server explicitly enables owner-only testing.",
  };
}
