import { config } from "../../config.js";
import { HttpError } from "../../lib/errors.js";
import { gswSystemPrompt } from "./prompt.js";
import type { AiProvider, AiProviderMessage, AiProviderRunInput, AiToolCall } from "./types.js";

type OpenAiOutputItem =
  | { type: "message"; content?: Array<{ type: string; text?: string }> }
  | { type: "function_call"; call_id?: string; id?: string; name?: string; arguments?: string };

interface OpenAiResponse {
  output?: OpenAiOutputItem[];
  error?: { message?: string };
}

const toInput = (messages: AiProviderMessage[]) => {
  const input: Array<Record<string, unknown>> = [];
  for (const message of messages) {
    if (message.role === "user") {
      input.push({ role: "user", content: message.content });
      continue;
    }
    if (message.role === "assistant") {
      if (message.content) input.push({ role: "assistant", content: message.content });
      for (const call of message.tool_calls ?? []) {
        input.push({
          type: "function_call",
          call_id: call.id,
          name: call.function.name,
          arguments: call.function.arguments,
        });
      }
      continue;
    }
    input.push({
      type: "function_call_output",
      call_id: message.tool_call_id,
      output: message.content,
    });
  }
  return input;
};

export const openAiProvider: AiProvider = {
  id: "openai",
  async run(input: AiProviderRunInput) {
    if (!config.ai.openaiApiKey) {
      throw new HttpError(503, "OpenAI is not configured. Add OPENAI_API_KEY to the API service.");
    }
    const model = config.ai.openaiModel;
    if (!model) {
      throw new HttpError(503, "OpenAI is not configured. Add OPENAI_MODEL to the API service.");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.ai.timeoutMs);
    try {
      const response = await fetch(`${config.ai.openaiBaseUrl.replace(/\/$/, "")}/responses`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${config.ai.openaiApiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: model,
          instructions: gswSystemPrompt,
          input: toInput(input.messages),
          ...(input.tools?.length ? {
            tools: input.tools.map((tool) => ({
              type: "function",
              name: tool.function.name,
              description: tool.function.description,
              parameters: tool.function.parameters,
              strict: false,
            })),
          } : {}),
        }),
        signal: controller.signal,
      });

      const body = await response.json().catch(() => ({})) as OpenAiResponse;
      if (!response.ok) {
        throw new HttpError(response.status === 429 ? 429 : 502, body.error?.message?.trim() || `OpenAI returned HTTP ${response.status}`);
      }

      const textParts: string[] = [];
      const toolCalls: AiToolCall[] = [];
      for (const item of body.output ?? []) {
        if (item.type === "message") {
          for (const part of item.content ?? []) {
            if (part.type === "output_text" && typeof part.text === "string") textParts.push(part.text);
          }
        } else if (item.type === "function_call" && item.name) {
          toolCalls.push({
            id: item.call_id ?? item.id ?? crypto.randomUUID(),
            type: "function",
            function: {
              name: item.name,
              arguments: item.arguments ?? "{}",
            },
          });
        }
      }

      const content = textParts.join("\n").trim() || null;
      if (!content && toolCalls.length === 0) throw new HttpError(502, "OpenAI returned an empty response.");
      return { content, toolCalls, model: model };
    } catch (error) {
      if (error instanceof HttpError) throw error;
      if (error instanceof Error && error.name === "AbortError") throw new HttpError(504, "OpenAI request timed out.");
      throw new HttpError(502, "OpenAI is temporarily unavailable.");
    } finally {
      clearTimeout(timeout);
    }
  },
};
