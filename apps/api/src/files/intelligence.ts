import { config } from "../config.js";
import { HttpError } from "../lib/errors.js";
import { detectFileType } from "./fileTypes.js";
import { extractPdfText } from "./localExtraction.js";

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
    let contentFilePart: Record<string, unknown>;
    if (input.image) {
      contentFilePart = {
        type: "input_image",
        image_url: `data:${input.mimeType || "application/octet-stream"};base64,${input.bytes.toString("base64")}`,
        detail: "auto",
      };
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

async function textAnalysis(input: {
  filename: string;
  mimeType: string;
  bytes: Buffer;
  instruction: string;
}) {
  void input.instruction;
  const text = input.bytes.toString("utf8").slice(0, 120_000).trim();
  if (!text) throw new HttpError(422, "No readable text was found in this file.");
  return { text, model: "gsw-local-text-extractor", mode: "text" as const };
}

async function pdfTextAnalysis(input: {
  filename: string;
  mimeType: string;
  bytes: Buffer;
  instruction: string;
}) {
  void input.filename;
  void input.mimeType;
  void input.instruction;
  try {
    const text = await extractPdfText(input.bytes, 120_000);
    return { text, model: "gsw-local-pdf-extractor", mode: "document" as const };
  } catch (error) {
    throw new HttpError(422, error instanceof Error ? error.message : "The PDF could not be read.");
  }
}
async function sandboxAnalysis(input: {
  filename: string;
  mimeType: string;
  bytes: Buffer;
  instruction: string;
  category: string;
}) {
  if (input.bytes.byteLength > 100 * 1024 * 1024) {
    throw new HttpError(400, "Best-effort sandbox analysis currently supports files up to 100 MB.");
  }

  const { apiKey, baseUrl } = ensureOpenAi();
  const model = config.ai.openaiArtifactModel;
  const fileId = await uploadInputFile(input);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(config.ai.timeoutMs, 180_000));
  try {
    const response = await fetch(`${baseUrl}/responses`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        tools: [{
          type: "code_interpreter",
          container: {
            type: "auto",
            file_ids: [fileId],
          },
        }],
        tool_choice: "required",
        input: [
          `Inspect the attached ${input.category} file "${input.filename}" using the code interpreter.`,
          input.instruction,
          "Work from the real file contents, not just metadata.",
          "For spreadsheets, inspect sheets, headers, formulas, values, totals, dates, and anomalies.",
          "For archives/packages, list meaningful contents and safely inspect relevant small files without blindly expanding huge nested payloads.",
          "For images in uncommon formats, convert to a common format if needed and inspect what can be determined.",
          "For video, inspect metadata and sample representative frames if the environment supports it; clearly distinguish visual findings from audio transcript findings.",
          "For unknown binary formats, identify the format and extract whatever meaningful content is safely accessible.",
          "Return a concise, grounded analysis. Do not claim successful extraction if the file could not actually be opened.",
        ].join("\n"),
      }),
      signal: controller.signal,
    });
    const requestId = response.headers.get("x-request-id") ?? response.headers.get("request-id");
    const body = await response.json().catch(() => ({})) as OpenAiResponse;
    if (!response.ok) {
      const message = body.error?.message?.trim() || `OpenAI sandbox analysis returned HTTP ${response.status}`;
      console.error("[file-intelligence] sandbox analysis failed", {
        filename: input.filename,
        mimeType: input.mimeType,
        category: input.category,
        model,
        status: response.status,
        requestId,
        message,
      });
      throw new HttpError(response.status === 429 ? 429 : 502, message);
    }
    const analyzed = outputText(body);
    if (!analyzed) throw new HttpError(502, "The sandbox analysis service returned an empty response.");
    return { text: analyzed, model, mode: "sandbox" as const };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (error instanceof Error && error.name === "AbortError") throw new HttpError(504, "Sandbox file analysis timed out.");
    throw new HttpError(502, "The sandbox file analysis service is temporarily unavailable.");
  } finally {
    clearTimeout(timeout);
    await deleteInputFile(fileId);
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
  const detected = detectFileType(input.filename, input.mimeType);

  switch (detected.strategy) {
    case "text":
      return textAnalysis(input);
    case "vision":
      return responseAnalysis({ ...input, image: true });
    case "openai_file":
      return detected.category === "pdf"
        ? pdfTextAnalysis(input)
        : responseAnalysis({ ...input, image: false });
    case "code_interpreter":
      return sandboxAnalysis({ ...input, category: detected.category });
    case "transcription":
      try {
        return await transcribe(input);
      } catch (error) {
        const fallback = await sandboxAnalysis({ ...input, category: detected.category });
        return {
          ...fallback,
          note: `Direct transcription failed, so the file was inspected in the computational workspace instead. ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    case "video": {
      let transcript: Awaited<ReturnType<typeof transcribe>> | null = null;
      let visual: Awaited<ReturnType<typeof sandboxAnalysis>> | null = null;
      try {
        transcript = await transcribe(input);
      } catch {
        transcript = null;
      }
      try {
        visual = await sandboxAnalysis({ ...input, category: detected.category });
      } catch {
        visual = null;
      }
      if (!transcript && !visual) {
        throw new HttpError(502, "The video could not be analyzed by either transcription or sandbox inspection.");
      }
      return {
        text: [
          ...(transcript ? ["[AUDIO TRANSCRIPT]", transcript.text] : []),
          ...(visual ? ["[VISUAL / FILE INSPECTION]", visual.text] : []),
        ].join("\n\n"),
        model: visual?.model ?? transcript?.model ?? config.ai.openaiArtifactModel,
        mode: "video" as const,
        note: transcript && visual
          ? "Video analysis combined audio transcription with best-effort computational frame/file inspection."
          : transcript
            ? "Only the audio track could be analyzed."
            : "Only computational visual/file inspection could be completed.",
      };
    }
    case "best_effort":
    default:
      return sandboxAnalysis({ ...input, category: detected.category });
  }
}
