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

const systemPrompt = [
  "You are the GSW Mail writing assistant.",
  "You are a general conversational assistant with a strong focus on helping users write, rewrite, shorten, clarify, and improve emails.",
  "Do not claim to have read the user's mailbox, contacts, calendar, or files unless the user explicitly pasted that information into the conversation.",
  "You do not have tools and cannot send email, edit drafts, schedule meetings, change settings, or take any other action.",
  "If the user asks you to take an action, explain briefly that you can help prepare the wording but the user must perform the action themselves.",
  "Preserve the user's intended meaning and voice when rewriting. Prefer natural, concise business language unless the user asks for another tone.",
  "Do not add facts, promises, names, dates, or commitments that the user did not provide.",
].join(" ");

export async function runHetznerChat(messages: AiChatMessage[]): Promise<{ content: string; model: string }> {
  if (!config.ai.hetznerApiKey) {
    throw new HttpError(503, "AI chat is not configured yet. Add HETZNER_INFERENCE_KEY to the API service.");
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
      const providerMessage = body.error?.message?.trim();
      throw new HttpError(response.status === 429 ? 429 : 502, providerMessage || `Hetzner inference returned HTTP ${response.status}`);
    }

    const content = body.choices?.[0]?.message?.content?.trim();
    if (!content) throw new HttpError(502, "Hetzner inference returned an empty response.");
    return { content, model: config.ai.hetznerModel };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (error instanceof Error && error.name === "AbortError") throw new HttpError(504, "AI chat timed out. Try again.");
    throw new HttpError(502, "AI chat is temporarily unavailable.");
  } finally {
    clearTimeout(timeout);
  }
}
