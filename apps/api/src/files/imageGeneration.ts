import { config } from "../config.js";
import { HttpError } from "../lib/errors.js";
import { verifyGeneratedImage } from "./imageValidation.js";
import { classifyImageAttempt } from "./imageReliability.js";

type ImageResponse = {
  data?: Array<{ b64_json?: string }>;
  error?: { message?: string };
};

type ImageInput = {
  prompt: string;
  model?: "auto" | "qwen-image-2512" | "openai-image" | undefined;
  size?: "1024x1024" | "1536x1024" | "1024x1536" | "auto" | undefined;
  quality?: "low" | "medium" | "high" | "auto" | undefined;
  background?: "transparent" | "opaque" | "auto" | undefined;
  format?: "png" | "jpeg" | "webp" | undefined;
};

type GeneratedImage = {
  bytes: Buffer;
  mimeType: string;
  extension: string;
  model: string;
  width: number;
  height: number;
};

const dimensionsFor = (size: ImageInput["size"]) => {
  switch (size) {
    case "1536x1024": return { width: 1536, height: 1024 };
    case "1024x1536": return { width: 1024, height: 1536 };
    case "1024x1024": return { width: 1024, height: 1024 };
    default: return { width: 1024, height: 1024 };
  }
};

const validate = (bytes: Buffer, model: string): GeneratedImage => ({ ...verifyGeneratedImage(bytes), model });

const parseProviderError = async (response: Response) => {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("json")) return (await response.text().catch(() => "")).trim();
  const body = await response.json().catch(() => ({})) as {
    error?: string | { message?: string };
    message?: string;
  };
  return typeof body.error === "string"
    ? body.error.trim()
    : body.error?.message?.trim() || body.message?.trim() || "";
};

async function generateWithDedicatedHuggingFaceEndpoint(input: ImageInput, deadline: number): Promise<GeneratedImage> {
  if (!config.ai.huggingFaceApiToken || !config.ai.huggingFaceImageEndpointUrl) {
    throw new HttpError(503, "A dedicated Hugging Face image endpoint is not configured.");
  }

  const { width, height } = dimensionsFor(input.size);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1, Math.min(90_000, deadline - Date.now())));
  try {
    const response = await fetch(config.ai.huggingFaceImageEndpointUrl, {
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
          ...(input.quality === "high" ? { num_inference_steps: 30 } : input.quality === "low" ? { num_inference_steps: 8 } : {}),
        },
      }),
      signal: controller.signal,
    });

    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (!response.ok || contentType.includes("application/json")) {
      const detail = await parseProviderError(response);
      throw new HttpError([400,401,403,404,422,429].includes(response.status) ? response.status : 502, `Hugging Face endpoint HTTP ${response.status}`);
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length) throw new HttpError(502, "Hugging Face image endpoint returned no image data.");
    return validate(bytes, config.ai.huggingFaceImageModel);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (error instanceof Error && error.name === "AbortError") throw new HttpError(504, "Hugging Face image endpoint timed out.");
    throw new HttpError(502, "Hugging Face image endpoint failed.");
  } finally {
    clearTimeout(timeout);
  }
}

async function generateWithHuggingFaceModel(model: string, input: ImageInput, deadline: number): Promise<GeneratedImage> {
  if (!config.ai.huggingFaceApiToken) throw new HttpError(503, "Hugging Face image generation is not configured.");

  const { width, height } = dimensionsFor(input.size);
  const endpoint = `${config.ai.huggingFaceImageBaseUrl.replace(/\/$/, "")}/${model}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1, Math.min(90_000, deadline - Date.now())));
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
          ...(input.quality === "high"
            ? { num_inference_steps: 30 }
            : input.quality === "low"
              ? { num_inference_steps: 4 }
              : { num_inference_steps: 12 }),
        },
      }),
      signal: controller.signal,
    });

    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (!response.ok || contentType.includes("application/json")) {
      const detail = await parseProviderError(response);
      if (response.status === 401) {
        throw new HttpError(401, detail || "Hugging Face rejected the configured token.");
      }
      throw new HttpError([400,401,403,404,422,429].includes(response.status) ? response.status : 502, `Hugging Face model HTTP ${response.status}`);
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length) throw new HttpError(502, `Hugging Face model ${model} returned no image data.`);
    return validate(bytes, model);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (error instanceof Error && error.name === "AbortError") throw new HttpError(504, `Hugging Face model ${model} timed out.`);
    throw new HttpError(502, "Hugging Face image model failed.");
  } finally {
    clearTimeout(timeout);
  }
}

async function generateWithOpenAi(input: ImageInput, deadline: number): Promise<GeneratedImage> {
  if (!config.ai.openaiApiKey) throw new HttpError(503, "No image generation provider is configured.");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1, Math.min(90_000, deadline - Date.now())));
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
      throw new HttpError([400,401,403,404,422,429].includes(response.status) ? response.status : 502, `OpenAI image generation HTTP ${response.status}`);
    }
    const encoded = body.data?.[0]?.b64_json;
    if (!encoded) throw new HttpError(502, "The image generation service returned no image data.");
    return validate(Buffer.from(encoded, "base64"), config.ai.openaiImageModel);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (error instanceof Error && error.name === "AbortError") throw new HttpError(504, "Image generation timed out.");
    throw new HttpError(502, "Image generation is temporarily unavailable.");
  } finally {
    clearTimeout(timeout);
  }
}

async function generateWithModal(input: ImageInput, deadline: number): Promise<GeneratedImage> {
  const token = config.ai.modalProxyToken;
  const base = config.ai.qwenImageBaseUrl;
  if (!token || !base) throw new HttpError(503, "Modal image generation is not configured.");
  const url = new URL(base);
  if (url.protocol !== "https:") throw new HttpError(503, "Invalid Modal image endpoint.");
  const endpoint = new URL(url.pathname.replace(/\/$/, "") + "/v1/images/generations", url.origin);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, Math.min(90_000, deadline - Date.now())));
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ model: "Qwen/Qwen-Image-2512", prompt: input.prompt, size: input.size === "auto" ? "1024x1024" : input.size ?? "1024x1024", response_format: "b64_json" }),
      signal: controller.signal,
    });
    if (!response.ok) throw new HttpError([400,401,403,422,429].includes(response.status) ? response.status : 502, "Modal image generation failed.");
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.startsWith("image/")) return validate(Buffer.from(await response.arrayBuffer()), "qwen-image-2512");
    const body = await response.json() as { data?: Array<{ b64_json?: string; url?: string }> };
    const encoded = body.data?.[0]?.b64_json;
    if (!encoded) throw new HttpError(502, "Modal returned no inline image.");
    return validate(Buffer.from(encoded, "base64"), "qwen-image-2512");
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(error instanceof Error && error.name === "AbortError" ? 504 : 502, "Modal image generation is temporarily unavailable.");
  } finally { clearTimeout(timer); }
}

export type ImageGenerationOptions = { correlationId?: string; maxDurationMs?: number };
export async function generateImage(input: ImageInput, options: ImageGenerationOptions = {}) {
  const started = Date.now();
  const budget = Math.max(5_000, Math.min(options.maxDurationMs ?? 90_000, 180_000));
  const correlationId = options.correlationId ?? "untracked";
  const deadline = started + budget;
  const attempts: Array<{ provider: "modal" | "huggingface" | "openai"; model: string; run: () => Promise<GeneratedImage> }> = [];
  if (config.ai.modalProxyToken && config.ai.qwenImageBaseUrl && input.model !== "openai-image") {
    attempts.push({ provider: "modal", model: "qwen-image-2512", run: () => generateWithModal(input, deadline) });
  }
  if (input.model !== "qwen-image-2512" && input.model !== "openai-image" && !config.ai.qwenImageBaseUrl) {
    if (config.ai.huggingFaceImageEndpointUrl) attempts.push({
      provider: "huggingface", model: config.ai.huggingFaceImageModel,
      run: () => generateWithDedicatedHuggingFaceEndpoint(input, Math.min(deadline, Date.now() + 30_000)),
    });
    for (const model of (config.ai.huggingFaceImageModels.length ? config.ai.huggingFaceImageModels : [config.ai.huggingFaceImageModel]).slice(0, config.ai.openaiApiKey ? 1 : 2)) {
      attempts.push({ provider: "huggingface", model, run: () => generateWithHuggingFaceModel(model, input, Math.min(deadline, Date.now() + 30_000)) });
    }
  }
  if (config.ai.openaiApiKey && input.model !== "qwen-image-2512") attempts.push({
    provider: "openai", model: config.ai.openaiImageModel, run: () => generateWithOpenAi(input, deadline),
  });
  if (!attempts.length) throw new HttpError(503, "Image generation is not configured.");
  let lastStatus = 502;
  for (const [index, attempt] of attempts.slice(0, 3).entries()) {
    const remaining = budget - (Date.now() - started);
    if (remaining < 1_000) break;
    const began = Date.now();
    try {
      const result = await attempt.run();
      console.info("[gsw-image] attempt", { correlationId, provider: attempt.provider, model: attempt.model, attempt: index + 1, durationMs: Date.now()-began, outcome: "success", width: result.width, height: result.height, mimeType: result.mimeType, bytes: result.bytes.length });
      return result;
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 502;
      lastStatus = status;
      const category = classifyImageAttempt(status);
      console.warn("[gsw-image] attempt", { correlationId, provider: attempt.provider, model: attempt.model, attempt: index + 1, durationMs: Date.now()-began, outcome: "failure", status, category });
      if (category === "permanent") break;
    }
  }
  throw new HttpError(lastStatus === 429 ? 429 : 502, "Image generation failed. Please retry later.");
}
