import { config } from "../config.js";
import { HttpError } from "../lib/errors.js";

type OpenAiOutputItem = {
  type?: string;
  content?: Array<{ type?: string; text?: string }>;
  [key: string]: unknown;
};

type OpenAiResponse = {
  output?: OpenAiOutputItem[];
  error?: { message?: string };
};

const outputText = (body: OpenAiResponse): string => {
  const parts: string[] = [];
  for (const item of body.output ?? []) {
    if (item.type !== "message") continue;
    for (const part of item.content ?? []) {
      if (part.type === "output_text" && typeof part.text === "string") parts.push(part.text);
    }
  }
  return parts.join("\n").trim();
};

const ensureOpenAi = () => {
  if (!config.ai.openaiApiKey) {
    throw new HttpError(503, "Deep file understanding requires OPENAI_API_KEY on the API service.");
  }
  return {
    apiKey: config.ai.openaiApiKey,
    baseUrl: config.ai.openaiBaseUrl.replace(/\/$/, ""),
    model: config.ai.openaiFileModel,
  };
};

async function uploadInputFile(input: { filename: string; mimeType: string; bytes: Buffer }) {
  const { apiKey, baseUrl } = ensureOpenAi();
  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(input.bytes)], { type: input.mimeType || "application/octet-stream" }),
    input.filename,
  );
  form.append("purpose", "user_data");
  const response = await fetch(`${baseUrl}/files`, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}` },
    body: form,
  });
  const body = await response.json().catch(() => ({})) as { id?: string; error?: { message?: string } };
  if (!response.ok || !body.id) {
    throw new HttpError(
      response.status === 429 ? 429 : 502,
      body.error?.message?.trim() || `OpenAI file upload returned HTTP ${response.status}`,
    );
  }
  return body.id;
}

async function deleteInputFile(fileId: string) {
  const { apiKey, baseUrl } = ensureOpenAi();
  await fetch(`${baseUrl}/files/${encodeURIComponent(fileId)}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${apiKey}` },
  }).catch(() => undefined);
}

const documentLike = (mimeType: string, filename: string) =>
  mimeType === "application/pdf"
  || /\.(pdf|doc|docx|rtf|odt|ppt|pptx|xls|xlsx|csv|tsv|txt|md|json|html|xml)$/i.test(filename);

const imageLike = (mimeType: string, filename: string) =>
  mimeType.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/i.test(filename);

const audioLike = (mimeType: string, filename: string) =>
  mimeType.startsWith("audio/")
  || /\.(flac|mp3|mpeg|mpga|m4a|ogg|wav|webm)$/i.test(filename);

const videoAudioLike = (mimeType: string, filename: string) =>
  mimeType.startsWith("video/") || /\.(mp4|mpeg|webm|m4v)$/i.test(filename);

async function responseAnalysis(input: {
  filename: string;
  mimeType: string;
  bytes: Buffer;
  instruction: string;
  image: boolean;
}) {
  const { apiKey, baseUrl, model } = ensureOpenAi();
  if (input.bytes.byteLength > 50 * 1024 * 1024) {
    throw new HttpError(400, "Files sent for deep document analysis must be 50 MB or smaller.");
  }

  let uploadedFileId: string | null = null;
  try {
    const filePart = input.image
      ? {
          type: "input_image",
          image_url: `data:${input.mimeType || "application/octet-stream"};base64,${input.bytes.toString("base64")}`,
          detail: "auto",
        }
      : (() => {
          throw new Error("DOCUMENT_FILE_ID_PENDING");
        })();

    let contentFilePart: Record<string, unknown>;
    if (input.image) {
      contentFilePart = filePart;
    } else {
      uploadedFileId = await uploadInputFile(input);
      contentFilePart = {
        type: "input_file",
        file_id: uploadedFileId,
        ...(input.mimeType === "application/pdf" || /\.pdf$/i.test(input.filename) ? { detail: "auto" } : {}),
      };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.max(config.ai.timeoutMs, 90_000));
    try {
      const response = await fetch(`${baseUrl}/responses`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model,
          input: [{
            role: "user",
            content: [
              contentFilePart,
              { type: "input_text", text: input.instruction },
            ],
          }],
        }),
        signal: controller.signal,
      });
      const requestId = response.headers.get("x-request-id") ?? response.headers.get("request-id");
      const body = await response.json().catch(() => ({})) as OpenAiResponse;
      if (!response.ok) {
        const message = body.error?.message?.trim() || `OpenAI file analysis returned HTTP ${response.status}`;
        console.error("[file-intelligence] OpenAI analysis failed", {
          filename: input.filename,
          mimeType: input.mimeType,
          model,
          status: response.status,
          requestId,
          message,
        });
        throw new HttpError(response.status === 429 ? 429 : 502, message);
      }
      const text = outputText(body);
      if (!text) {
        console.error("[file-intelligence] OpenAI analysis returned empty output", {
          filename: input.filename,
          mimeType: input.mimeType,
          model,
          requestId,
        });
        throw new HttpError(502, "The file analysis service returned an empty response.");
      }
      return { text, model, mode: input.image ? "vision" as const : "document" as const };
    } catch (error) {
      if (error instanceof HttpError) throw error;
      if (error instanceof Error && error.name === "AbortError") throw new HttpError(504, "File analysis timed out.");
      console.error("[file-intelligence] OpenAI analysis request failed", {
        filename: input.filename,
        mimeType: input.mimeType,
        model,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new HttpError(502, "The file analysis service is temporarily unavailable.");
    } finally {
      clearTimeout(timeout);
    }
  } finally {
    if (uploadedFileId) await deleteInputFile(uploadedFileId);
  }
}
async function transcribe(input: {
  filename: string;
  mimeType: string;
  bytes: Buffer;
}) {
  const { apiKey, baseUrl } = ensureOpenAi();
  if (input.bytes.byteLength > 25 * 1024 * 1024) {
    throw new HttpError(400, "Audio/video transcription inputs must be 25 MB or smaller.");
  }
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(input.bytes)], { type: input.mimeType || "application/octet-stream" }), input.filename);
  form.append("model", config.ai.openaiTranscriptionModel);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(config.ai.timeoutMs, 120_000));
  try {
    const response = await fetch(`${baseUrl}/audio/transcriptions`, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}` },
      body: form,
      signal: controller.signal,
    });
    const body = await response.json().catch(() => ({})) as { text?: string; error?: { message?: string } };
    if (!response.ok) {
      throw new HttpError(response.status === 429 ? 429 : 502, body.error?.message?.trim() || `OpenAI transcription returned HTTP ${response.status}`);
    }
    const text = body.text?.trim();
    if (!text) throw new HttpError(502, "The transcription service returned an empty transcript.");
    return { text, model: config.ai.openaiTranscriptionModel, mode: "transcription" as const };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (error instanceof Error && error.name === "AbortError") throw new HttpError(504, "Transcription timed out.");
    throw new HttpError(502, "The transcription service is temporarily unavailable.");
  } finally {
    clearTimeout(timeout);
  }
}

export async function analyzeStoredFile(input: {
  filename: string;
  mimeType: string;
  bytes: Buffer;
  instruction: string;
}) {
  if (imageLike(input.mimeType, input.filename)) {
    return responseAnalysis({ ...input, image: true });
  }
  if (documentLike(input.mimeType, input.filename)) {
    return responseAnalysis({ ...input, image: false });
  }
  if (audioLike(input.mimeType, input.filename)) {
    return transcribe(input);
  }
  if (videoAudioLike(input.mimeType, input.filename)) {
    const result = await transcribe(input);
    return {
      ...result,
      note: "This analyzes the video's audio track only; visual frame understanding is not enabled yet.",
    };
  }
  throw new HttpError(400, "This file type is not supported by deep file analysis yet.");
}
