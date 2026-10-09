import { readFile } from "node:fs/promises";
import { config } from "../config.js";
import { renderLocalPdf } from "./localPdfRenderer.js";
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
    if (/^#{3,6}\s+/.test(line)) { closeList(); out.push(`<h3>${inline(line.replace(/^#{3,6}\s+/, ""))}</h3>`); continue; }
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

const pdfBaseStyles = `
  @page { size: Letter; margin: 14mm 15mm; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  html, body { margin: 0; min-height: 100%; }
  body { background: #fffdf9; color: #252c39; font-family: Arial, Helvetica, sans-serif; font-size: 10pt; line-height: 1.5; }
  .gsw-page { padding: 14px 10px; }
  .gsw-report-hero { background: #152f50; color: #fff; padding: 28px 30px; margin: 0 0 22px; break-inside: avoid; }
  .gsw-report-hero h1 { color: #fff; margin: 0 0 7px; font-size: 28pt; line-height: 1.13; }
  .gsw-report-hero p { margin: 0; color: #e1edf8; }
  .gsw-metrics { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin: 20px 0 25px; }
  .gsw-metric { background: #eaf1f8; border: 1px solid #d7e4f1; border-radius: 10px; padding: 16px; }
  .gsw-metric-value { display: block; color: #153a64; font-size: 25pt; line-height: 1.1; font-weight: 800; }
  .gsw-metric-label { color: #475568; font-size: 9pt; }
  .gsw-two-col { columns: 2; column-gap: 28px; }
  .gsw-two-col li { break-inside: avoid; }
  h1, h2, h3 { break-after: avoid; }
  h1 { font-size: 24pt; line-height: 1.18; margin: 0 0 12px; }
  h2 { font-size: 15pt; color: #1b4f77; margin: 17px 0 8px; }
  h3 { font-size: 11pt; margin: 13px 0 6px; }
  p { margin: 0 0 10px; }
  ul, ol { margin: 6px 0 12px; padding-left: 22px; }
  li { margin-bottom: 5px; }
  table { width: 100%; border-collapse: collapse; margin: 12px 0; }
  th, td { text-align: left; padding: 9px 12px; border-bottom: 1px solid #dce3ea; }
  th { background: #e8eef5; }
  /* GSW:TC branded print components */
  .gsw-brand-logo { width: 62px; height: auto; max-height: 58px; object-fit: contain; display: block; margin-bottom: 12px; }\n  .gsw-tc { --gsw-brand: #41865b; --gsw-cream: #f4e8cd; --gsw-ink: #484640; --gsw-stroke: #e8e1d4; color: var(--gsw-ink); background: #fffdf8; }
  .gsw-tc .gsw-report-hero { background: var(--gsw-brand); color: #fff; }
  .gsw-tc .gsw-report-hero h1, .gsw-tc .gsw-report-hero p { color: #fff; }
  .gsw-tc h2 { color: var(--gsw-brand); }
  .gsw-tc .gsw-metric { background: var(--gsw-cream); border-color: var(--gsw-stroke); }
  .gsw-tc .gsw-metric-value { color: var(--gsw-brand); }
  .gsw-tc .gsw-metric-label { color: var(--gsw-ink); }
  .gsw-feature-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; align-items: stretch; }
  .gsw-feature-card { padding: 15px; background: #fff; border: 1px solid #e8e1d4; border-radius: 9px; break-inside: avoid; page-break-inside: avoid; }
  .gsw-feature-card h3 { margin-top: 0; color: #41865b; }
  .gsw-page-section { break-inside: avoid; page-break-inside: avoid; }
  .gsw-report-hero, .gsw-metric, .gsw-feature-card { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .gsw-tc .gsw-report-footer { border-color: var(--gsw-stroke); color: var(--gsw-ink); }
  .gsw-report-footer { margin: 16px 0 0; border-top: 1px solid #dce3ea; padding: 10px 0 0; color: #697687; font-size: 8.5pt; break-inside: avoid; page-break-inside: avoid; break-before: avoid; }
`;

const pdfPrintSafetyStyles = `
  @page { size: Letter; margin: 14mm 15mm !important; }
  html, body { max-width: 100%; }
  .gsw-tc .gsw-report-hero { margin-left: 0 !important; margin-right: 0 !important; padding: 24px 28px !important; }
  .gsw-tc .gsw-brand-logo { margin-left: 8px !important; margin-top: 8px !important; }
  .gsw-tc .gsw-report-footer, .gsw-tc footer { break-inside: avoid !important; page-break-inside: avoid !important; break-before: avoid !important; page-break-before: avoid !important; height: auto !important; min-height: 0 !important; padding: 12px 16px !important; margin: 16px 0 0 !important; }
  .gsw-tc .gsw-feature-card, .gsw-tc .gsw-metric { break-inside: avoid; }
`;

export function composePdfHtml(content: string): string {
  const isHtml = /<\/?(?:html|body|section|div|header|main|article|h[1-6]|p|table|ul|ol|li)\b/i.test(content);
  const body = isHtml ? content : simpleMarkdownToHtml(content);
  const hasDocument = /<!doctype html|<html\b/i.test(body);
  if (hasDocument) {
    // Preserve the model's full page composition, including its head/CSS.
    // Append print-safe defaults rather than putting a second HTML document inside it.
    return body.replace(/<\/head>/i, `<style>${pdfBaseStyles}${pdfPrintSafetyStyles}</style></head>`);
  }
  return `<!doctype html><html><head><meta charset="utf-8"><style>${pdfBaseStyles}</style></head><body><main class="gsw-page">${body}</main></body></html>`;
}

async function generateLocalPdf(input: { filename: string; content: string; instruction: string }) {
  try {
    let html = composePdfHtml(input.content);
    // Only inject the real GSW logo into explicitly branded documents.
    // Keep the asset local and inline; renderer network access remains blocked.
    if (/class=["'][^"']*gsw-tc/i.test(html) && !/class=["'][^"']*gsw-brand-logo/i.test(html)) {
      const image = await readFile("/app/apps/api/assets/brand-logo.png").catch(() => null);
      if (image) {
        const img = `<img class="gsw-brand-logo" alt="GSW Mail" src="data:image/png;base64,${image.toString("base64")}">`;
        const hero = /(<(?:header|section|div)\\b[^>]*class=["'][^"']*gsw-report-hero[^"']*["'][^>]*>)/i;
        html = hero.test(html) ? html.replace(hero, `$1${img}`) : html.replace(/<body([^>]*)>/i, `<body$1>${img}`);
      }
    }
    const rendered = await renderLocalPdf(html);
    return { filename: input.filename, bytes: rendered, mimeType: "application/pdf", model: "gsw-local-pdf" };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new HttpError(502, `Local PDF generation failed: ${message}`);
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
    if (!input.content?.trim()) {
      throw new HttpError(422, "PDF document content or HTML is required separately from design directions.");
    }
    return generateLocalPdf({ filename: target, content: input.content.trim(), instruction: input.instruction });
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
      ...(/\.pdf$/i.test(target) ? [
        "PDF-specific requirement: produce a genuinely redesigned final document, not an explanation of the instructions or a plain-text transcript.",
        "Analyze supplied PDF pages for content and visual structure. Use the source as the factual reference, and the user instruction as the design brief.",
        "Use proper page composition, contrasting shapes, professional typography, custom tables and graphics as appropriate to the topic.",
        "Where a named brand is requested, use accessible brand assets from the uploaded files; never fabricate logos or claim an asset was used if it was not available.",
        "Preserve the requested number of pages and keep body copy readable. If a one-page output is requested, honor it.",
        "Do not print Markdown tokens, source prompts, or design specification instructions as the PDF body.",
        "Verify the output file exists, opens as a PDF, and has legible complete pages before finishing.",
      ] : []),
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
