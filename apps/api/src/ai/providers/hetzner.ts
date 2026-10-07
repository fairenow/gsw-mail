import { config } from "../../config.js";
import { HttpError } from "../../lib/errors.js";
import { gswSystemPrompt } from "./prompt.js";
import type { AiProvider, AiProviderRunInput } from "./types.js";

interface HetznerChatResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }>;
    };
  }>;
  error?: { message?: string };
}

class HetznerAttemptError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly publicStatus: number,
  ) {
    super(message);
    this.name = "HetznerAttemptError";
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function attempt(input: AiProviderRunInput) {
  if (!config.ai.hetznerApiKey) {
    throw new HttpError(503, "Hetzner AI is not configured. Add HETZNER_INFERENCE_KEY to the API service.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.ai.timeoutMs);
  try {
    const response = await fetch(`${config.ai.hetznerBaseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.ai.hetznerApiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: config.ai.hetznerModel,
        messages: [{ role: "system", content: gswSystemPrompt }, ...input.messages],
        ...(input.tools?.length ? { tools: input.tools, tool_choice: "auto" } : {}),
        temperature: 0.35,
        max_tokens: 1600,
        stream: false,
      }),
      signal: controller.signal,
    });

    const body = await response.json().catch(() => ({})) as HetznerChatResponse;
    if (!response.ok) {
      const providerMessage = body.error?.message?.trim() || `Hetzner inference returned HTTP ${response.status}`;
      throw new HetznerAttemptError(providerMessage, response.status === 429 || response.status >= 500, response.status === 429 ? 429 : 502);
    }

    const message = body.choices?.[0]?.message;
    const content = message?.content?.trim() || null;
    const toolCalls = message?.tool_calls ?? [];
    if (!content && toolCalls.length === 0) throw new HetznerAttemptError("Hetzner inference returned an empty response.", true, 502);
    return { content, toolCalls, model: config.ai.hetznerModel };
  } catch (error) {
    if (error instanceof HttpError || error instanceof HetznerAttemptError) throw error;
    if (error instanceof Error && error.name === "AbortError") throw new HetznerAttemptError("AI chat timed out.", true, 504);
    throw new HetznerAttemptError("AI chat is temporarily unavailable.", true, 502);
  } finally {
    clearTimeout(timeout);
  }
}

export const hetznerProvider: AiProvider = {
  id: "hetzner",
  async run(input) {
    let lastError: HetznerAttemptError | null = null;
    for (let attemptNumber = 0; attemptNumber < 2; attemptNumber += 1) {
      try {
        return await attempt(input);
      } catch (error) {
        if (error instanceof HttpError) throw error;
        const failure = error instanceof HetznerAttemptError
          ? error
          : new HetznerAttemptError("AI chat is temporarily unavailable.", true, 502);
        lastError = failure;
        if (!failure.retryable || attemptNumber === 1) break;
        await sleep(650);
      }
    }
    throw new HttpError(lastError?.publicStatus ?? 502, lastError?.message ? `${lastError.message} Please try again.` : "AI chat is temporarily unavailable. Please try again.");
  },
};
