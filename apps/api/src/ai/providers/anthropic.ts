import { config } from "../../config.js";
import { HttpError } from "../../lib/errors.js";
import { gswSystemPrompt } from "./prompt.js";
import type { AiProvider, AiProviderMessage, AiProviderRunInput, AiToolCall } from "./types.js";

type AnthropicBlock =
  | { type: "text"; text?: string }
  | { type: "tool_use"; id?: string; name?: string; input?: Record<string, unknown> };

interface AnthropicResponse {
  content?: AnthropicBlock[];
  error?: { message?: string };
}

const toMessages = (messages: AiProviderMessage[]) => {
  const output: Array<{ role: "user" | "assistant"; content: unknown }> = [];
  let pendingToolResults: Array<{ type: "tool_result"; tool_use_id: string; content: string }> = [];

  const flushToolResults = () => {
    if (pendingToolResults.length === 0) return;
    output.push({ role: "user", content: pendingToolResults });
    pendingToolResults = [];
  };

  for (const message of messages) {
    if (message.role === "tool") {
      pendingToolResults.push({
        type: "tool_result",
        tool_use_id: message.tool_call_id,
        content: message.content,
      });
      continue;
    }

    flushToolResults();
    if (message.role === "user") {
      output.push({ role: "user", content: message.content });
      continue;
    }

    const blocks: Array<Record<string, unknown>> = [];
    if (message.content) blocks.push({ type: "text", text: message.content });
    for (const call of message.tool_calls ?? []) {
      let parsed: unknown = {};
      try { parsed = JSON.parse(call.function.arguments || "{}"); } catch { parsed = {}; }
      blocks.push({
        type: "tool_use",
        id: call.id,
        name: call.function.name,
        input: parsed,
      });
    }
    output.push({ role: "assistant", content: blocks });
  }

  flushToolResults();
  return output;
};

export const anthropicProvider: AiProvider = {
  id: "anthropic",
  async run(input: AiProviderRunInput) {
    if (!config.ai.anthropicApiKey) {
      throw new HttpError(503, "Anthropic is not configured. Add ANTHROPIC_API_KEY to the API service.");
    }
    if (!config.ai.anthropicModel) {
      throw new HttpError(503, "Anthropic is not configured. Add ANTHROPIC_MODEL to the API service.");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.ai.timeoutMs);
    try {
      const response = await fetch(`${config.ai.anthropicBaseUrl.replace(/\/$/, "")}/messages`, {
        method: "POST",
        headers: {
          "x-api-key": config.ai.anthropicApiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: config.ai.anthropicModel,
          max_tokens: 1600,
          system: gswSystemPrompt,
          messages: toMessages(input.messages),
          ...(input.tools?.length ? {
            tools: input.tools.map((tool) => ({
              name: tool.function.name,
              description: tool.function.description,
              input_schema: tool.function.parameters,
            })),
          } : {}),
        }),
        signal: controller.signal,
      });

      const body = await response.json().catch(() => ({})) as AnthropicResponse;
      if (!response.ok) {
        throw new HttpError(response.status === 429 ? 429 : 502, body.error?.message?.trim() || `Anthropic returned HTTP ${response.status}`);
      }

      const textParts: string[] = [];
      const toolCalls: AiToolCall[] = [];
      for (const block of body.content ?? []) {
        if (block.type === "text" && block.text) textParts.push(block.text);
        if (block.type === "tool_use" && block.name) {
          toolCalls.push({
            id: block.id ?? crypto.randomUUID(),
            type: "function",
            function: {
              name: block.name,
              arguments: JSON.stringify(block.input ?? {}),
            },
          });
        }
      }

      const content = textParts.join("\n").trim() || null;
      if (!content && toolCalls.length === 0) throw new HttpError(502, "Anthropic returned an empty response.");
      return { content, toolCalls, model: config.ai.anthropicModel };
    } catch (error) {
      if (error instanceof HttpError) throw error;
      if (error instanceof Error && error.name === "AbortError") throw new HttpError(504, "Anthropic request timed out.");
      throw new HttpError(502, "Anthropic is temporarily unavailable.");
    } finally {
      clearTimeout(timeout);
    }
  },
};
