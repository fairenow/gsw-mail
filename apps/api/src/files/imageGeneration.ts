import { config } from "../config.js";
import { HttpError } from "../lib/errors.js";

type ImageResponse = {
  data?: Array<{ b64_json?: string }>;
  error?: { message?: string };
};

const dimensionsFor = (size: "1024x1024" | "1536x1024" | "1024x1536" | "auto" | undefined) => {
  switch (size) {
    case "1536x1024": return { width: 1536, height: 1024 };
    case "1024x1536": return { width: 1024, height: 1536 };
    case "1024x1024": return { width: 1024, height: 1024 };
    default: return { width: 1024, height: 1024 };
  }
};

async function generateWithHuggingFace(input: {
  prompt: string;
  size?: "1024x1024" | "1536x1024" | "1024x1536" | "auto" | undefined;
  quality?: "low" | "medium" | "high" | "auto" | undefined;
  background?: "transparent" | "opaque" | "auto" | undefined;
  format?: "png" | "jpeg" | "webp" | undefined;
}) {
  if (!config.ai.huggingFaceApiToken) throw new HttpError(503, "Hugging Face image generation is not configured.");
  const { width, height } = dimensionsFor(input.size);
  const model = config.ai.huggingFaceImageModel;
  const endpoint = `${config.ai.huggingFaceImageBaseUrl.replace(/\/$/, "")}/${model}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(config.ai.timeoutMs, 180_000));
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.ai.huggingFaceApiToken}`,
        accept: "image/png,image/jpeg,image/webp,*/*",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        inputs: input.prompt,
        parameters: {
          width,
          height,
          ...(input.quality === "high" ? { num_inference_steps: 8 } : input.quality === "low" ? { num_inference_steps: 4 } : {}),
        },
      }),
      signal: controller.signal,
    });

    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (!response.ok || contentType.includes("application/json")) {
      const body = await response.json().catch(() => ({})) as { error?: string | { message?: string }; message?: string };
      const detail = typeof body.error === "string" ? body.error : body.error?.message ?? body.message;
      throw new HttpError(response.status === 429 ? 429 : 502, detail?.trim() || `Hugging Face image generation returned HTTP ${response.status}`);
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length) throw new HttpError(502, "Hugging Face image generation returned no image data.");
    const mimeType = contentType.startsWith("image/") ? contentType.split(";")[0]! : "image/png";
    const extension = mimeType.includes("jpeg") ? "jpg" : mimeType.includes("webp") ? "webp" : "png";
    return { bytes, mimeType, extension, model };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (error instanceof Error && error.name === "AbortError") throw new HttpError(504, "Hugging Face image generation timed out.");
    throw new HttpError(502, error instanceof Error ? `Hugging Face image generation failed: ${error.message}` : "Hugging Face image generation failed.");
  } finally {
    clearTimeout(timeout);
  }
}

async function generateWithOpenAi(input: {
  prompt: string;
  size?: "1024x1024" | "1536x1024" | "1024x1536" | "auto" | undefined;
  quality?: "low" | "medium" | "high" | "auto" | undefined;
  background?: "transparent" | "opaque" | "auto" | undefined;
  format?: "png" | "jpeg" | "webp" | undefined;
}) {
  if (!config.ai.openaiApiKey) throw new HttpError(503, "No image generation provider is configured.");
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

export async function generateImage(input: {
  prompt: string;
  size?: "1024x1024" | "1536x1024" | "1024x1536" | "auto" | undefined;
  quality?: "low" | "medium" | "high" | "auto" | undefined;
  background?: "transparent" | "opaque" | "auto" | undefined;
  format?: "png" | "jpeg" | "webp" | undefined;
}) {
  // Prefer FLUX when a Hugging Face token is configured. This keeps image
  // generation independent from the conversational model and OpenAI billing.
  if (config.ai.huggingFaceApiToken) return generateWithHuggingFace(input);
  return generateWithOpenAi(input);
}
