import { config } from "../config.js";
import { HttpError } from "../lib/errors.js";

export type AiChatRole = "user" | "assistant";

export interface AiChatMessage {
  role: AiChatRole;
  content: string;
}

interface HetznerChatResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
  error?: {
    message?: string;
  };
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

const systemPrompt = [
  "You are the GSW Mail writing assistant.",
  "You are a general conversational assistant with a strong focus on helping users write, rewrite, shorten, clarify, and improve emails.",
  "Do not claim to have read the user's mailbox, contacts, calendar, or files unless the user explicitly pasted that information into the conversation.",
  "You do not have tools and cannot send email, edit drafts, schedule meetings, change settings, or take any other action.",
  "If the user asks you to take an action, explain briefly that you can help prepare the wording but the user must perform the action themselves.",
  "Preserve the user's intended meaning and voice when rewriting. Prefer natural, concise business language unless the user asks for another tone.",
  "Do not add facts, promises, names, dates, or commitments that the user did not provide.",
  "When you provide a final email draft, rewritten email, reply, follow-up, or other copy-ready email text, wrap only that email in exact <email_draft> and </email_draft> tags.",
  "You may add a short explanation before or after the email draft, but never place commentary inside the <email_draft> tags.",
  "If you provide multiple distinct email options, wrap each option in its own <email_draft> block.",
].join(" ");

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function attemptHetznerChat(messages: AiChatMessage[]): Promise<string> {
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
        messages: [
          { role: "system", content: systemPrompt },
          ...messages,
        ],
        temperature: 0.45,
        max_tokens: 1400,
        stream: false,
      }),
      signal: controller.signal,
    });

    const body = await response.json().catch(() => ({})) as HetznerChatResponse;
    if (!response.ok) {
      const providerMessage = body.error?.message?.trim() || `Hetzner inference returned HTTP ${response.status}`;
      const retryable = response.status === 429 || response.status >= 500;
      throw new HetznerAttemptError(providerMessage, retryable, response.status === 429 ? 429 : 502);
    }

    const content = body.choices?.[0]?.message?.content?.trim();
    if (!content) throw new HetznerAttemptError("Hetzner inference returned an empty response.", true, 502);
    return content;
  } catch (error) {
    if (error instanceof HetznerAttemptError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new HetznerAttemptError("AI chat timed out.", true, 504);
    }
    throw new HetznerAttemptError("AI chat is temporarily unavailable.", true, 502);
  } finally {
    clearTimeout(timeout);
  }
}

export async function runHetznerChat(messages: AiChatMessage[]): Promise<{ content: string; model: string }> {
  if (!config.ai.hetznerApiKey) {
    throw new HttpError(503, "AI chat is not configured yet. Add HETZNER_INFERENCE_KEY to the API service.");
  }

  let lastError: HetznerAttemptError | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const content = await attemptHetznerChat(messages);
      return { content, model: config.ai.hetznerModel };
    } catch (error) {
      const failure = error instanceof HetznerAttemptError
        ? error
        : new HetznerAttemptError("AI chat is temporarily unavailable.", true, 502);
      lastError = failure;
      if (!failure.retryable || attempt === 1) break;
      await sleep(650);
    }
  }

  throw new HttpError(
    lastError?.publicStatus ?? 502,
    lastError?.message ? `${lastError.message} Please try again.` : "AI chat is temporarily unavailable. Please try again.",
  );
}
