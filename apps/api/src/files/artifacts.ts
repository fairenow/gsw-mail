import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { config } from "../config.js";
import { HttpError } from "../lib/errors.js";

const execFileAsync = promisify(execFile);

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

    const bytes = Buffer.from(await fileResponse.arrayBuffer());
    if (/\.pdf$/i.test(target) && (!bytes.subarray(0, 5).equals(Buffer.from("%PDF-")) || bytes.length < 500)) {
      throw new HttpError(502, "Artifact service returned an invalid PDF, so nothing was saved.");
    }
    return {
      filename: target,
      bytes,
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

const escapeHtml = (value: string) => value
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");

const simpleMarkdownToHtml = (source: string) => {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let inList: "ul" | "ol" | null = null;

  const closeList = () => {
    if (inList) out.push(`</${inList}>`);
    inList = null;
  };

  const inline = (value: string) => escapeHtml(value)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>");

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      closeList();
      continue;
    }
    if (/^###\s+/.test(line)) { closeList(); out.push(`<h3>${inline(line.replace(/^###\s+/, ""))}</h3>`); continue; }
    if (/^##\s+/.test(line)) { closeList(); out.push(`<h2>${inline(line.replace(/^##\s+/, ""))}</h2>`); continue; }
    if (/^#\s+/.test(line)) { closeList(); out.push(`<h1>${inline(line.replace(/^#\s+/, ""))}</h1>`); continue; }
    const ordered = line.match(/^\d+[.)]\s+(.+)$/);
    if (ordered) {
      if (inList !== "ol") { closeList(); inList = "ol"; out.push("<ol>"); }
      out.push(`<li>${inline(ordered[1] ?? "")}</li>`);
      continue;
    }
    const bullet = line.match(/^[-*•]\s+(.+)$/);
    if (bullet) {
      if (inList !== "ul") { closeList(); inList = "ul"; out.push("<ul>"); }
      out.push(`<li>${inline(bullet[1] ?? "")}</li>`);
      continue;
    }
    closeList();
    out.push(`<p>${inline(line)}</p>`);
  }
  closeList();
  return out.join("\n");
};

async function generateLocalPdf(input: { filename: string; content: string; instruction: string }) {
  const dir = await mkdtemp(join(tmpdir(), "gsw-artifact-"));
  try {
    const htmlPath = join(dir, "document.html");
    const outputPath = join(dir, input.filename);
    const body = /<\/?(?:html|body|section|div|h1|h2|h3|p|ul|ol|li|table|strong|em)\b/i.test(input.content)
      ? input.content
      : simpleMarkdownToHtml(input.content);

    const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  @page { size: Letter; margin: 0.55in; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #292722; font-size: 10.5pt; line-height: 1.35; }
  h1 { font-size: 24pt; line-height: 1.05; margin: 0 0 10pt; color: #25221d; }
  h2 { font-size: 14pt; margin: 12pt 0 5pt; color: #b96f00; }
  h3 { font-size: 11pt; margin: 9pt 0 3pt; color: #575047; }
  p { margin: 0 0 7pt; }
  ul, ol { margin: 4pt 0 8pt 18pt; padding: 0; }
  li { margin: 0 0 3pt; }
  strong { color: #25221d; }
  table { width: 100%; border-collapse: collapse; margin: 8pt 0; }
  th, td { border: 1px solid #e5dccb; padding: 5pt; text-align: left; vertical-align: top; }
  th { background: #fbf2dc; }
  .gsw-accent { height: 5pt; background: #ee9a00; margin: 0 0 14pt; }
  .gsw-note { margin-top: 12pt; padding-top: 7pt; border-top: 1px solid #eadfca; color: #756d63; font-size: 8.5pt; }
</style>
</head>
<body>
<div class="gsw-accent"></div>
${body}
</body>
</html>`;

    await writeFile(htmlPath, html, "utf8");
    const { stderr } = await execFileAsync("libreoffice", [
      "--headless",
      "--convert-to", "pdf",
      "--outdir", dir,
      htmlPath,
    ], { timeout: 120_000, maxBuffer: 4 * 1024 * 1024 });

    const generatedPath = join(dir, "document.pdf");
    const bytes = await readFile(generatedPath).catch(() => null);
    if (!bytes?.length) {
      throw new HttpError(502, stderr?.trim() || "LibreOffice did not produce a PDF.");
    }
    return {
      filename: input.filename,
      bytes,
      mimeType: "application/pdf",
      model: "gsw-local-libreoffice-pdf",
    };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new HttpError(502, `Local PDF generation failed: ${message}`);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function generateArtifactFile(input: {
  filename: string;
  instruction: string;
  content?: string;
  containerId?: string;
}) {
  const target = input.filename.trim();
  if (/\.pdf$/i.test(target)) {
    if (!input.content?.trim() && !config.ai.openaiApiKey) {
      throw new HttpError(503, "Designed PDF generation requires an enabled artifact service. No PDF was saved: design instructions are not document content.");
    }
    // Design-first PDFs use the code-interpreter artifact service, which can
    // compose real vector graphics, typography, layouts, tables and embedded
    // images. Local LibreOffice is retained only when that service is absent.
    // Do not silently downgrade when a configured service actually fails.
    if (config.ai.openaiApiKey) {
      const prompt = [
        `Produce a finished, professionally art-directed PDF named "${target}".`,
        "Use the code_interpreter tool to programmatically DESIGN and CREATE the PDF (ReportLab, matplotlib, PIL, or other available tools).",
        "This is a graphic-design task, NOT a plain-text Markdown-to-PDF export.",
        "Compose a distinctive layout with thoughtful typography, contrasting color fields, designed section hierarchy, vector icons/ornamentation, structured tables and intentional whitespace when appropriate.",
        "Make the design specific to the subject and the user's brand instructions; do not force GSW's own brand onto another organization's document.",
        "If the request calls for one page, fit the content legibly on exactly one page; simplify the editorial copy rather than shrinking it into illegibility.",
        "Draw text and vector elements as real PDF objects, so text remains selectable and the layout stays sharp.",
        "Never print raw Markdown notation such as #, ####, **, or code fences. Convert all supplied content into proper visual elements.",
        "Treat content supplied below as source facts: do not fabricate statistics, dates, logos, screenshots, claims or brand assets.",
        "Use a supplied logo only when its actual bytes are available. Otherwise create a refined typographic treatment, never invent a brand logo.",
        "Check the final page count, visible legibility, margins, overflow, and content completeness using the available file tools before finishing.",
        "Your answer must include the finished file as a downloadable container_file_citation.",
        `User design requirements: ${input.instruction}`,
        `Source content to preserve and visually organize:\n${input.content?.trim() || input.instruction}`,
        `Save the final PDF with exactly this filename: ${target}`,
      ].join("\n");
      return runArtifactResponse({ filename: target, prompt, ...(input.containerId ? { containerId: input.containerId } : {}) });
    }
    return generateLocalPdf({
      filename: target,
      content: input.content!.trim(),
      instruction: input.instruction,
    });
  }
  const prompt = [
    `Create exactly one finished file named "${target}".`,
    "Use the python/code interpreter tool to generate the file.",
    "The result must be a real downloadable file, not markdown pretending to be a file.",
    "Keep the output polished and usable.",
    input.instruction,
    `Before finishing, save the final artifact using the exact filename: ${target}`,
  ].join("\n");
  return runArtifactResponse({
    filename: target,
    prompt,
    ...(input.containerId ? { containerId: input.containerId } : {}),
  });
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
      ...(!input.containerId ? { sourceFileIds: uploadedIds } : {}),
      ...(input.containerId ? { containerId: input.containerId } : {}),
    });
  } finally {
    if (!input.containerId) {
      await Promise.all(uploadedIds.map((fileId) => deleteOpenAiFile(fileId)));
    }
  }
}
