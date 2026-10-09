import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);

export function validatePrintableHtml(html: string): void {
  if (html.length > 600_000) throw new Error("PDF HTML exceeds size limit");
  if (/<(?:script|iframe|object|embed|link|base|form)\b/i.test(html)
    || /\bon[a-z]+\s*=/i.test(html)
    || /@import\b/i.test(html)
    || /url\s*\(/i.test(html)
    || /\b(?:href|action)\s*=/i.test(html)
    || [...html.matchAll(/\bsrc\s*=\s*(?:"([^"]*)"|\x27([^\x27]*)\x27|([^\s>]+))/gi)].some((match) => !/^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/i.test(match[1] ?? match[2] ?? match[3] ?? ""))) {
    throw new Error("PDF HTML contains unsupported active or external content");
  }
}

export async function renderLocalPdf(html: string): Promise<Buffer> {
  validatePrintableHtml(html);
  const workerUrl = process.env.PDF_RENDER_WORKER_URL;
  if (workerUrl) {
    const token = process.env.PDF_RENDER_TOKEN;
    if (!token) throw new Error("PDF worker token is missing");
    const url = new URL(workerUrl);
    if (url.protocol !== "http:" || !url.hostname.endsWith(".railway.internal") || url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) throw new Error("Invalid private PDF worker address");
    try {
      const response = await fetch(new URL("/render", url), {
        method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({ html }), signal: AbortSignal.timeout(52_000),
      });
      if (!response.ok) throw new Error("worker_failed");
      const pdf = Buffer.from(await response.arrayBuffer());
      if (pdf.length < 500 || pdf.length > 15_000_000 || pdf.toString("ascii", 0, 5) !== "%PDF-") throw new Error("invalid_pdf");
      return pdf;
    } catch (error) {
      console.error("[pdf.render] isolated worker failure", { errorType: error instanceof Error ? error.name : "Unknown" });
      throw new Error("PDF generation is temporarily unavailable. Please retry.");
    }
  }
  if (process.env.NODE_ENV === "production") throw new Error("Private PDF rendering service is not configured");
  const dir = await mkdtemp(join(tmpdir(), "gsw-pdf-"));
  try {
    const source = join(dir, "page.html");
    const output = join(dir, "page.pdf");
    await writeFile(source, html, "utf8");
    // Designed PDFs require the CSS layout engine; silently falling back to
    // LibreOffice destroys grids and print backgrounds while appearing successful.
    try {
      await execute("chromium", [
        "--headless", "--disable-dev-shm-usage",
        // Railway container sandbox disallows Chromium namespace sandbox setup.
        // Container-level isolation remains in place; renderer HTML cannot load network resources.
        "--no-sandbox", "--disable-setuid-sandbox",
        "--disable-background-networking", "--disable-extensions",
        "--no-first-run", "--disable-default-apps",
        "--user-data-dir=" + join(dir, "chromium-profile"),
        "--print-to-pdf-no-header", "--print-to-pdf=" + output,
        "file://" + source,
      ], { timeout: 45000, killSignal: "SIGKILL", maxBuffer: 2 * 1024 * 1024 });
    } catch (error) {
      const errorType = error instanceof Error ? error.name : "UnknownError";
      console.error("[pdf.render] chromium execution failed", { errorType, renderer: "chromium" });
      throw new Error("Designed PDF could not be rendered with Chromium. Please retry or contact support.");
    }
    const pdf = await readFile(output);
    if (pdf.length < 500 || pdf.toString("ascii", 0, 5) !== "%PDF-") {
      throw new Error("PDF renderer returned invalid output");
    }
    // Preflight the generated file instead of accepting a header-only PDF.
    const { stdout } = await execute("pdfinfo", [output], { timeout: 10000, maxBuffer: 1024 * 1024 });
    const pages = Number(stdout.match(/^Pages:\s+(\d+)/m)?.[1] ?? 0);
    if (!Number.isInteger(pages) || pages < 1 || pages > 30) {
      throw new Error("PDF failed pagination preflight: " + pages + " pages");
    }
    console.info("[pdf.render] completed", { renderer: "chromium", pages, bytes: pdf.length });
    return pdf;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
