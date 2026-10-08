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
  const dir = await mkdtemp(join(tmpdir(), "gsw-pdf-"));
  try {
    const source = join(dir, "page.html");
    const output = join(dir, "page.pdf");
    await writeFile(source, html, "utf8");
    try {
      await execute("chromium", [
        "--headless", "--disable-dev-shm-usage",
        "--disable-background-networking", "--disable-extensions",
        "--user-data-dir=" + join(dir, "chromium-profile"), "--print-to-pdf-no-header",
        "--print-to-pdf=" + output, "file://" + source,
      ], { timeout: 45000, killSignal: "SIGKILL" });
    } catch (chromiumError) {
      try {
        await execute("libreoffice", [
        "-env:UserInstallation=file://" + join(dir, "profile"),
        "--headless", "--convert-to", "pdf", "--outdir", dir, source,
        ], { timeout: 45000, killSignal: "SIGKILL" });
      } catch (libreOfficeError) {
        const shortMessage = (error: unknown) => error instanceof Error ? error.message.slice(0, 900) : String(error).slice(0, 900);
        throw new Error("Both local PDF renderers failed. Chromium: " + shortMessage(chromiumError) + "; LibreOffice: " + shortMessage(libreOfficeError));
      }
    }
    const pdf = await readFile(output);
    if (pdf.length < 500 || pdf.toString("ascii", 0, 5) !== "%PDF-") {
      throw new Error("PDF renderer returned invalid output");
    }
    return pdf;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
