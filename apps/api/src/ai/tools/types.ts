export type AgentRisk = "read" | "reversible_write" | "external";

export interface AgentExecutionContext {
  userId: string;
  authUserId: string;
  accountId: string;
  headers: Record<string, string>;
  accessToken?: string | undefined;
  conversationId?: string | undefined;
  timeZone?: string | undefined;
  scheduledIdempotencyKey?: string | undefined;
}

export interface AgentToolResult<T = unknown> {
  ok: boolean;
  toolCallId: string;
  data?: T;
  error?: {
    code: string;
    message: string;
    retryable: boolean;
  };
  audit: {
    userId: string;
    accountId: string;
    startedAt: string;
    completedAt: string;
  };
}

export interface AgentToolDefinition<TInput = unknown, TOutput = unknown> {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  requiredScopes: string[];
  risk: AgentRisk;
  execute: (ctx: AgentExecutionContext, input: TInput, toolCallId: string) => Promise<AgentToolResult<TOutput>>;
}

export interface ProviderToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}
