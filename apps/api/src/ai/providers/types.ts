import type { ProviderToolDefinition } from "../tools/types.js";

export type AiProviderId = "hetzner" | "openai" | "anthropic" | "huggingface";
export type AiChatRole = "user" | "assistant";

export interface AiToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export type AiProviderMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: AiToolCall[] }
  | { role: "tool"; content: string; tool_call_id: string };

export interface AiProviderRunInput {
  messages: AiProviderMessage[];
  tools?: ProviderToolDefinition[] | undefined;
}

export interface AiProviderRunResult {
  content: string | null;
  toolCalls: AiToolCall[];
  model: string;
}

export interface AiProvider {
  id: AiProviderId;
  run(input: AiProviderRunInput): Promise<AiProviderRunResult>;
}
