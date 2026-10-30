import { z } from "zod";
import { config } from "../../config.js";
import { HttpError } from "../../lib/errors.js";
import { gswSystemPrompt } from "./prompt.js";
import type { AiProvider } from "./types.js";

const toolCall = z.object({ id: z.string().min(1), type: z.literal("function").default("function"), function: z.object({ name: z.string().min(1), arguments: z.string().refine(value => { try { const v = JSON.parse(value); return v !== null && typeof v === "object" && !Array.isArray(v); } catch { return false; } }) }) });
const completion = z.object({ choices: z.array(z.object({ finish_reason: z.string().optional(), message: z.object({ content: z.string().nullable().optional(), reasoning_content: z.string().optional(), tool_calls: z.array(toolCall).optional() }) })).min(1) });

export const kimiProvider: AiProvider = {
  id: "kimi",
  async run(input) {
    if (!config.ai.kimiApiKey) throw new HttpError(503, "Kimi is not configured. Add KIMI_API_KEY to the API service.");
    try {
      const response = await fetch(`${config.ai.kimiBaseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { authorization: `Bearer ${config.ai.kimiApiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ model: config.ai.kimiModel, messages: [{ role: "system", content: gswSystemPrompt }, ...input.messages], ...(input.tools?.length ? { tools: input.tools, tool_choice: "auto" } : {}), reasoning_effort: "low", max_completion_tokens: 16384, stream: false }),
        signal: AbortSignal.timeout(config.ai.timeoutMs),
      });
      if (!response.ok) throw new HttpError(response.status === 429 ? 429 : 502, "Kimi could not complete this request. Check the provider configuration and account availability.");
      const parsed = completion.safeParse(await response.json());
      if (!parsed.success) throw new HttpError(502, "Kimi returned an invalid response or tool call.");
      const choice = parsed.data.choices[0]!;
      if (choice.finish_reason === "length") throw new HttpError(502, "Kimi returned an incomplete response. Please retry with a smaller request.");
      const message = choice.message;
      const content = message.content?.trim() || null;
      const toolCalls = message.tool_calls ?? [];
      if (!content && !toolCalls.length) throw new HttpError(502, "Kimi returned no response.");
      return { content, toolCalls, model: config.ai.kimiModel, ...(message.reasoning_content !== undefined ? { reasoningContent: message.reasoning_content } : {}) };
    } catch (error) {
      if (error instanceof HttpError) throw error;
      if (error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name)) throw new HttpError(504, "Kimi timed out. Please retry.");
      throw new HttpError(502, "Kimi is temporarily unavailable.");
    }
  },
};
