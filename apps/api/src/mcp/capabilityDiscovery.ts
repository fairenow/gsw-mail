import type { AgentToolDefinition } from "../ai/tools/types.js";

export interface McpCapabilityEntry {
  name: string;
  description: string;
  requiredScopes: string[];
  risk: "read" | "reversible_write" | "external";
  status: "available_for_read" | "oauth_scope_missing" | "write_transport_disabled";
  missingScopes: string[];
}

/**
 * Discover the backend's tool inventory without implying write actions are
 * callable. Actual read authorization is still checked per invocation.
 */
export function discoverMcpCapabilities(
  tools: readonly AgentToolDefinition[],
  oauthScopes: ReadonlySet<string>,
  options: { query?: string; offset?: number; limit?: number } = {},
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
            : "write_transport_disabled" as const,
        missingScopes,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  return {
    total: all.length,
    offset,
    nextOffset: offset + limit < all.length ? offset + limit : null,
    capabilities: all.slice(offset, offset + limit),
    note: "Read tools additionally require live GSW user grants and account access. Write tools are not executable over MCP until server-side approval and authorization are implemented.",
  };
}
