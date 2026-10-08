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

async function uploadOpenAiUserFile(input: { filename: string; mimeType: string; bytes: Buffer }) {
  const { apiKey, baseUrl } = ensureOpenAi();
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(input.bytes)], { type: input.mimeType || "application/octet-stream" }), input.filename);
  form.append("purpose", "user_data");
  const response = await fetch(`${baseUrl}/files`, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}` },
    body: form,
  });
  const body = await response.json().catch(() => ({})) as { id?: string; error?: { message?: string } };
  if (!response.ok || !body.id) {
    throw new HttpError(response.status === 429 ? 429 : 502, body.error?.message?.trim() || `OpenAI file upload returned HTTP ${response.status}`);
  }
  return body.id;
}

async function uploadContainerFile(containerId: string, input: { filename: string; mimeType: string; bytes: Buffer }) {
  const { apiKey, baseUrl } = ensureOpenAi();
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(input.bytes)], { type: input.mimeType || "application/octet-stream" }), input.filename);
  const response = await fetch(`${baseUrl}/containers/${encodeURIComponent(containerId)}/files`, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}` },
    body: form,
  });
  const body = await response.json().catch(() => ({})) as { id?: string; error?: { message?: string } };
  if (!response.ok || !body.id) {
    throw new HttpError(response.status === 429 ? 429 : 502, body.error?.message?.trim() || `OpenAI container file upload returned HTTP ${response.status}`);
  }
  return body.id;
}

async function deleteOpenAiFile(fileId: string) {
  const { apiKey, baseUrl } = ensureOpenAi();
  await fetch(`${baseUrl}/files/${encodeURIComponent(fileId)}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${apiKey}` },
  }).catch(() => undefined);
}

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

async function runArtifactResponse(input: {
  filename: string;
  prompt: string;
  sourceFileIds?: string[];
  containerId?: string;
}) {
  const { apiKey, baseUrl, model } = ensureOpenAi();
  const target = input.filename.trim();

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
          container: input.containerId
            ? input.containerId
            : {
                type: "auto",
                ...(input.sourceFileIds?.length ? { file_ids: input.sourceFileIds } : {}),
              },
        }],
        tool_choice: "required",
        input: input.prompt,
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

export async function generateArtifactFile(input: {
  filename: string;
  instruction: string;
  containerId?: string;
}) {
  const target = input.filename.trim();
  const prompt = [
    `Create exactly one finished file named "${target}".`,
    "Use the python/code interpreter tool to generate the file.",
    "The result must be a real downloadable file, not markdown pretending to be a file.",
    "Keep the output polished and usable.",
    input.instruction,
    `Before finishing, save the final artifact using the exact filename: ${target}`,
  ].join("\n");
  return runArtifactResponse({ filename: target, prompt, containerId: input.containerId });
}

export async function transformArtifactFile(input: {
  filename: string;
  instruction: string;
  sources: Array<{ filename: string; mimeType: string; bytes: Buffer }>;
  containerId?: string;
}) {
  if (!input.sources.length) throw new HttpError(400, "At least one source file is required.");
  if (input.sources.length > 5) throw new HttpError(400, "A maximum of 5 source files can be transformed at once.");

  const uploadedIds: string[] = [];
  try {
    if (input.containerId) {
      for (const source of input.sources) {
        await uploadContainerFile(input.containerId, source);
      }
    } else {
      for (const source of input.sources) {
        uploadedIds.push(await uploadOpenAiUserFile(source));
      }
    }

    const sourceNames = input.sources.map((source) => source.filename).join(", ");
    const target = input.filename.trim();
    const prompt = [
      `Transform the provided source file(s) into exactly one finished output file named "${target}".`,
      `Source files: ${sourceNames}`,
      "Use the python/code interpreter tool to inspect and modify the actual source file contents.",
      "Preserve useful structure, formulas, formatting, tables, charts, and data when relevant unless the user's instruction asks to change them.",
      "Do not invent data that is not present in the source files unless explicitly requested.",
      input.instruction,
      `Before finishing, save the final transformed file using the exact filename: ${target}`,
    ].join("\n");

    return await runArtifactResponse({
      filename: target,
      prompt,
      sourceFileIds: input.containerId ? undefined : uploadedIds,
      containerId: input.containerId,
    });
  } finally {
    if (!input.containerId) {
      await Promise.all(uploadedIds.map((fileId) => deleteOpenAiFile(fileId)));
    }
  }
}
