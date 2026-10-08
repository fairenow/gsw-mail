import { config } from "../config.js";
import { HttpError } from "../lib/errors.js";

type ImageResponse = {
  data?: Array<{ b64_json?: string }>;
  error?: { message?: string };
};

export async function generateImage(input: {
  prompt: string;
  size?: "1024x1024" | "1536x1024" | "1024x1536" | "auto" | undefined;
  quality?: "low" | "medium" | "high" | "auto" | undefined;
  background?: "transparent" | "opaque" | "auto" | undefined;
  format?: "png" | "jpeg" | "webp" | undefined;
}) {
  if (!config.ai.openaiApiKey) {
    throw new HttpError(503, "Image generation requires OPENAI_API_KEY on the API service.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(config.ai.timeoutMs, 120_000));
  try {
    const response = await fetch(`${config.ai.openaiBaseUrl.replace(/\/$/, "")}/images/generations`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.ai.openaiApiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: config.ai.openaiImageModel,
        prompt: input.prompt,
        size: input.size ?? "auto",
        quality: input.quality ?? "auto",
        background: input.background ?? "auto",
        output_format: input.format ?? "png",
      }),
      signal: controller.signal,
    });
    const body = await response.json().catch(() => ({})) as ImageResponse;
    if (!response.ok) {
      throw new HttpError(response.status === 429 ? 429 : 502, body.error?.message?.trim() || `OpenAI image generation returned HTTP ${response.status}`);
    }
    const encoded = body.data?.[0]?.b64_json;
    if (!encoded) throw new HttpError(502, "The image generation service returned no image data.");
    const format = input.format ?? "png";
    return {
      bytes: Buffer.from(encoded, "base64"),
      mimeType: format === "jpeg" ? "image/jpeg" : `image/${format}`,
      extension: format === "jpeg" ? "jpg" : format,
      model: config.ai.openaiImageModel,
    };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (error instanceof Error && error.name === "AbortError") throw new HttpError(504, "Image generation timed out.");
    throw new HttpError(502, "Image generation is temporarily unavailable.");
  } finally {
    clearTimeout(timeout);
  }
}
