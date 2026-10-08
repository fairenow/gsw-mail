import { config } from "../config.js";
import { HttpError } from "../lib/errors.js";

type ImageResponse = {
  data?: Array<{ b64_json?: string }>;
  error?: { message?: string };
};

type ImageInput = {
  prompt: string;
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
};

const dimensionsFor = (size: ImageInput["size"]) => {
  switch (size) {
    case "1536x1024": return { width: 1536, height: 1024 };
    case "1024x1536": return { width: 1024, height: 1536 };
    case "1024x1024": return { width: 1024, height: 1024 };
    default: return { width: 1024, height: 1024 };
  }
};

const extensionForMime = (mimeType: string) =>
  mimeType.includes("jpeg") ? "jpg" : mimeType.includes("webp") ? "webp" : "png";

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

async function generateWithDedicatedHuggingFaceEndpoint(input: ImageInput): Promise<GeneratedImage> {
  if (!config.ai.huggingFaceApiToken || !config.ai.huggingFaceImageEndpointUrl) {
    throw new HttpError(503, "A dedicated Hugging Face image endpoint is not configured.");
  }

  const { width, height } = dimensionsFor(input.size);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(config.ai.timeoutMs, 240_000));
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
      throw new HttpError(response.status === 429 ? 429 : 502, detail || `Hugging Face image endpoint returned HTTP ${response.status}`);
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length) throw new HttpError(502, "Hugging Face image endpoint returned no image data.");
    const mimeType = contentType.startsWith("image/") ? contentType.split(";")[0]! : "image/png";
    return {
      bytes,
      mimeType,
      extension: extensionForMime(mimeType),
      model: config.ai.huggingFaceImageModel,
    };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (error instanceof Error && error.name === "AbortError") throw new HttpError(504, "Hugging Face image endpoint timed out.");
    throw new HttpError(502, error instanceof Error ? `Hugging Face image endpoint failed: ${error.message}` : "Hugging Face image endpoint failed.");
  } finally {
    clearTimeout(timeout);
  }
}

async function generateWithHuggingFaceModel(model: string, input: ImageInput): Promise<GeneratedImage> {
  if (!config.ai.huggingFaceApiToken) throw new HttpError(503, "Hugging Face image generation is not configured.");

  const { width, height } = dimensionsFor(input.size);
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
      throw new HttpError(response.status === 429 ? 429 : 502, detail || `Hugging Face model ${model} returned HTTP ${response.status}`);
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length) throw new HttpError(502, `Hugging Face model ${model} returned no image data.`);
    const mimeType = contentType.startsWith("image/") ? contentType.split(";")[0]! : "image/png";
    return {
      bytes,
      mimeType,
      extension: extensionForMime(mimeType),
      model,
    };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (error instanceof Error && error.name === "AbortError") throw new HttpError(504, `Hugging Face model ${model} timed out.`);
    throw new HttpError(502, error instanceof Error ? `Hugging Face model ${model} failed: ${error.message}` : `Hugging Face model ${model} failed.`);
  } finally {
    clearTimeout(timeout);
  }
}

async function generateWithHuggingFace(input: ImageInput): Promise<GeneratedImage> {
  if (!config.ai.huggingFaceApiToken) throw new HttpError(503, "Hugging Face image generation is not configured.");

  const failures: string[] = [];

  if (config.ai.huggingFaceImageEndpointUrl) {
    try {
      return await generateWithDedicatedHuggingFaceEndpoint(input);
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }

  const models = config.ai.huggingFaceImageModels.length
    ? config.ai.huggingFaceImageModels
    : [config.ai.huggingFaceImageModel];

  for (const model of models) {
    try {
      return await generateWithHuggingFaceModel(model, input);
    } catch (error) {
      if (error instanceof HttpError && error.statusCode === 401) throw error;
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }

  throw new HttpError(
    502,
    failures.length
      ? `Hugging Face image generation failed across configured models: ${failures.join(" | ")}`
      : "Hugging Face image generation failed across configured models.",
  );
}

async function generateWithOpenAi(input: ImageInput): Promise<GeneratedImage> {
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

export async function generateImage(input: ImageInput) {
  if (config.ai.huggingFaceApiToken) {
    try {
      return await generateWithHuggingFace(input);
    } catch (error) {
      if (!config.ai.openaiApiKey) throw error;
    }
  }

  return generateWithOpenAi(input);
}
