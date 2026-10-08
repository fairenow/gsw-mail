import { config } from "../../config.js";
import { HttpError } from "../../lib/errors.js";
import { gswSystemPrompt } from "./prompt.js";
import type { AiProvider, AiProviderRunInput, AiToolCall } from "./types.js";

interface HuggingFaceChatResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: Array<{
        id?: string;
        type?: "function";
        function?: { name?: string; arguments?: string };
      }>;
    };
  }>;
  error?: { message?: string } | string;
  message?: string;
}

class HuggingFaceAttemptError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly publicStatus: number,
  ) {
    super(message);
    this.name = "HuggingFaceAttemptError";
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const providerErrorMessage = (body: HuggingFaceChatResponse, status: number) => {
  if (typeof body.error === "string") return body.error.trim();
  return body.error?.message?.trim() || body.message?.trim() || `Hugging Face returned HTTP ${status}`;
};

async function attempt(input: AiProviderRunInput) {
  if (!config.ai.huggingFaceApiToken) {
    throw new HttpError(503, "Hugging Face is not configured. Add HF_TOKEN or HUGGINGFACE_API_TOKEN to the API service.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.ai.timeoutMs);
  try {
    const response = await fetch(`${config.ai.huggingFaceChatBaseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.ai.huggingFaceApiToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: config.ai.huggingFaceChatModel,
        messages: [{ role: "system", content: gswSystemPrompt }, ...input.messages],
        ...(input.tools?.length ? { tools: input.tools, tool_choice: "auto" } : {}),
        max_tokens: 1600,
        reasoning_effort: config.ai.huggingFaceReasoningEffort,
        stream: false,
      }),
      signal: controller.signal,
    });

    const body = await response.json().catch(() => ({})) as HuggingFaceChatResponse;
    if (!response.ok) {
      const message = providerErrorMessage(body, response.status);
      if (response.status === 401 || response.status === 403) {
        throw new HttpError(response.status, message);
      }
      throw new HuggingFaceAttemptError(
        message,
        response.status === 408 || response.status === 429 || response.status >= 500,
        response.status === 429 ? 429 : 502,
      );
    }

    const message = body.choices?.[0]?.message;
    const content = message?.content?.trim() || null;
    const toolCalls: AiToolCall[] = (message?.tool_calls ?? [])
      .filter((call) => call.function?.name)
      .map((call) => ({
        id: call.id ?? crypto.randomUUID(),
        type: "function" as const,
        function: {
          name: call.function!.name!,
          arguments: call.function!.arguments ?? "{}",
        },
      }));

    if (!content && toolCalls.length === 0) {
      throw new HuggingFaceAttemptError("Hugging Face returned an empty response.", true, 502);
    }

    return {
      content,
      toolCalls,
      model: config.ai.huggingFaceChatModel,
    };
  } catch (error) {
    if (error instanceof HttpError || error instanceof HuggingFaceAttemptError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new HuggingFaceAttemptError("Hugging Face request timed out.", true, 504);
    }
    throw new HuggingFaceAttemptError(
      error instanceof Error ? `Hugging Face request failed: ${error.message}` : "Hugging Face is temporarily unavailable.",
      true,
      502,
    );
  } finally {
    clearTimeout(timeout);
  }
}

export const huggingFaceProvider: AiProvider = {
  id: "huggingface",
  async run(input) {
    let lastError: HuggingFaceAttemptError | null = null;
    for (let attemptNumber = 0; attemptNumber < 2; attemptNumber += 1) {
      try {
        return await attempt(input);
      } catch (error) {
        if (error instanceof HttpError) throw error;
        const failure = error instanceof HuggingFaceAttemptError
          ? error
          : new HuggingFaceAttemptError("Hugging Face is temporarily unavailable.", true, 502);
        lastError = failure;
        if (!failure.retryable || attemptNumber === 1) break;
        await sleep(650);
      }
    }

    throw new HttpError(
      lastError?.publicStatus ?? 502,
      lastError?.message ? `${lastError.message} Please try again.` : "Hugging Face is temporarily unavailable. Please try again.",
    );
  },
};
