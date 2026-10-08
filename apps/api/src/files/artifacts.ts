import { config } from "../config.js";
import { HttpError } from "../lib/errors.js";

type ContainerFileCitation = {
  type: "container_file_citation";
  container_id?: string;
  file_id?: string;
  filename?: string;
};

type ResponseContentPart = {
  type?: string;
  text?: string;
  annotations?: ContainerFileCitation[];
};

type ResponseOutputItem = {
  type?: string;
  content?: ResponseContentPart[];
};

type ArtifactResponse = {
  output?: ResponseOutputItem[];
  error?: { message?: string };
};

const ensureOpenAi = () => {
  if (!config.ai.openaiApiKey) {
    throw new HttpError(503, "Artifact generation requires OPENAI_API_KEY on the API service.");
  }
  return {
    apiKey: config.ai.openaiApiKey,
    baseUrl: config.ai.openaiBaseUrl.replace(/\/$/, ""),
    model: config.ai.openaiArtifactModel,
  };
};

const collectCitations = (body: ArtifactResponse) => {
  const citations: ContainerFileCitation[] = [];
  for (const item of body.output ?? []) {
    if (item.type !== "message") continue;
    for (const part of item.content ?? []) {
      for (const annotation of part.annotations ?? []) {
        if (annotation.type === "container_file_citation") citations.push(annotation);
      }
    }
  }
  return citations;
};

export const artifactMimeType = (filename: string) => {
  const ext = filename.split(".").pop()?.toLowerCase();
  return ({
    pdf: "application/pdf",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    csv: "text/csv",
    txt: "text/plain",
    md: "text/markdown",
    html: "text/html",
    json: "application/json",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
  } as Record<string, string>)[ext ?? ""] ?? "application/octet-stream";
};

export async function generateArtifactFile(input: {
  filename: string;
  instruction: string;
}) {
  const { apiKey, baseUrl, model } = ensureOpenAi();
  const target = input.filename.trim();
  const prompt = [
    `Create exactly one finished file named "${target}".`,
    "Use the python/code interpreter tool to generate the file.",
    "The result must be a real downloadable file, not markdown pretending to be a file.",
    "Keep the output polished and usable.",
    input.instruction,
    `Before finishing, save the final artifact using the exact filename: ${target}`,
  ].join("\n");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(config.ai.timeoutMs, 120_000));
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
          container: { type: "auto" },
        }],
        tool_choice: "required",
        input: prompt,
      }),
      signal: controller.signal,
    });

    const body = await response.json().catch(() => ({})) as ArtifactResponse;
    if (!response.ok) {
      throw new HttpError(response.status === 429 ? 429 : 502, body.error?.message?.trim() || `OpenAI artifact generation returned HTTP ${response.status}`);
    }

    const citations = collectCitations(body);
    const preferred = citations.find((item) => item.filename === target)
      ?? citations.find((item) => item.filename?.toLowerCase().endsWith(`.${target.split(".").pop()?.toLowerCase()}`))
      ?? citations[0];
    if (!preferred?.container_id || !preferred.file_id) {
      throw new HttpError(502, "The artifact generator completed without returning a downloadable file.");
    }

    const fileResponse = await fetch(
      `${baseUrl}/containers/${encodeURIComponent(preferred.container_id)}/files/${encodeURIComponent(preferred.file_id)}/content`,
      { headers: { authorization: `Bearer ${apiKey}` } },
    );
    if (!fileResponse.ok) {
      throw new HttpError(502, `Could not retrieve generated artifact: HTTP ${fileResponse.status}`);
    }

    return {
      filename: target,
      bytes: Buffer.from(await fileResponse.arrayBuffer()),
      mimeType: artifactMimeType(target),
      model,
    };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (error instanceof Error && error.name === "AbortError") throw new HttpError(504, "Artifact generation timed out.");
    throw new HttpError(502, "Artifact generation is temporarily unavailable.");
  } finally {
    clearTimeout(timeout);
  }
}
