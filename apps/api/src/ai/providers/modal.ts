import { config } from "../../config.js";
import { HttpError } from "../../lib/errors.js";
import { gswSystemPrompt } from "./prompt.js";
import type { AiProvider, AiProviderRunInput, AiToolCall } from "./types.js";

type ModalResponse = { choices?: Array<{ finish_reason?: string; message?: { content?: string | null; reasoning_content?: string | null; tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }> } }> };

/** GPT-OSS runs as vLLM on Modal; never execute provider tools here. */
export const modalProvider: AiProvider = {
  id: "modal",
  async run(input: AiProviderRunInput) {
    const base = config.ai.gptOssVllmBaseUrl;
    const token = config.ai.modalProxyToken;
    if (!base || !token) throw new HttpError(503, "GPT-OSS on Modal is not configured.");
    const url = new URL(base);
    if (url.protocol !== "https:") throw new HttpError(503, "Invalid Modal inference URL.");
    const endpoint = url.pathname.endsWith("/v1/chat/completions") ? url : new URL(url.pathname.replace(/\/$/, "") + "/v1/chat/completions", url.origin);
    const messages = [{ role: "system", content: gswSystemPrompt }, ...input.messages];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(config.ai.timeoutMs, 90_000));
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ model: "gpt-oss-120b", messages, ...(input.tools?.length ? { tools: input.tools, tool_choice: "auto", parallel_tool_calls: false } : {}), max_tokens: 4096, stream: false }),
        signal: controller.signal,
      });
      if (!response.ok) throw new HttpError(response.status === 429 ? 429 : 502, "Modal inference is currently unavailable.");
      const body = await response.json() as ModalResponse;
      const choice = body.choices?.[0];
      const message = choice?.message;
      if (choice?.finish_reason === "length") throw new HttpError(502, "Model output was incomplete.");
      const toolCalls: AiToolCall[] = (message?.tool_calls ?? []).map(call => ({
        id: call.id || crypto.randomUUID(), type: "function" as const,
        function: { name: call.function?.name ?? "", arguments: call.function?.arguments ?? "{}" },
      }));
      for (const call of toolCalls) {
        if (!call.function.name || !call.function.arguments || !isObjectJson(call.function.arguments)) throw new HttpError(502, "Modal returned an invalid tool call.");
      }
      const content = message?.content?.trim() || null;
      // Never display or persist model outputs containing unparsed reasoning or tool protocol.
      if (content && /<\|(?:im_start|im_end|channel_sep|fim_prefix)|(?:^|\n)assistant\s+(?:analysis|commentary)\b/i.test(content)) throw new HttpError(502, "Modal returned unparsed model output.");
      if (!content && !toolCalls.length) throw new HttpError(502, choice?.finish_reason === "length" ? "Model output was incomplete." : "Model returned an empty response.");
      return { content, toolCalls, model: "gpt-oss-120b" };
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(error instanceof Error && error.name === "AbortError" ? 504 : 502, "Modal inference is currently unavailable.");
    } finally { clearTimeout(timer); }
  },
};
function isObjectJson(value: string) {
  try { const parsed: unknown = JSON.parse(value); return !!parsed && typeof parsed === "object" && !Array.isArray(parsed); } catch { return false; }
}

/** DeepSeek uses the same GSW-owned tool runtime and OpenAI-compatible transport. */
export const modalDeepseekProvider: AiProvider = {
  id: "modal-deepseek",
  async run(input: AiProviderRunInput) {
    const base = process.env.DEEPSEEK_BASE_URL;
    const token = config.ai.modalProxyToken;
    if (!base || !token) throw new HttpError(503, "DeepSeek on Modal is not configured.");
    const url = new URL(base);
    if (url.protocol !== "https:") throw new HttpError(503, "Invalid Modal inference URL.");
    const endpoint = url.pathname.endsWith("/v1/chat/completions")
      ? url : new URL(url.pathname.replace(/\/$/, "") + "/v1/chat/completions", url.origin);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(config.ai.timeoutMs, 90_000));
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({
          model: "deepseek-ai/DeepSeek-V4.1-Flash",
          messages: [{ role: "system", content: gswSystemPrompt }, ...input.messages],
          ...(input.tools?.length ? { tools: input.tools, tool_choice: "auto", parallel_tool_calls: false } : {}),
          max_tokens: 4096, stream: false,
        }),
        signal: controller.signal,
      });
      if (!response.ok) throw new HttpError(response.status === 429 ? 429 : 502, "DeepSeek inference is unavailable.");
      const body = await response.json() as ModalResponse;
      const choice = body.choices?.[0];
      if (choice?.finish_reason === "length") throw new HttpError(502, "Model output was incomplete.");
      const calls: AiToolCall[] = (choice?.message?.tool_calls ?? []).map((call) => ({
        id: call.id ?? crypto.randomUUID(), type: "function",
        function: { name: call.function?.name ?? "", arguments: call.function?.arguments ?? "{}" },
      }));
      if (calls.some((call) => !call.function.name || !isObjectJson(call.function.arguments)))
        throw new HttpError(502, "DeepSeek returned an invalid tool call.");
      const content = choice?.message?.content?.trim() || null;
      if (content && /<\|(?:im_start|im_end|channel_sep|fim_prefix)|(?:^|\n)assistant\s+(?:analysis|commentary)\b/i.test(content))
        throw new HttpError(502, "DeepSeek returned unparsed model output.");
      if (!content && !calls.length) throw new HttpError(502, "DeepSeek returned an empty response.");
      return { content, toolCalls: calls, model: "deepseek-ai/DeepSeek-V4.1-Flash" };
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(error instanceof Error && error.name === "AbortError" ? 504 : 502, "DeepSeek inference is unavailable.");
    } finally { clearTimeout(timer); }
  },
};
