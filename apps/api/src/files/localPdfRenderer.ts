import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);

export async function renderLocalPdf(html: string): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), "gsw-pdf-"));
  try {
    const source = join(dir, "page.html");
    const output = join(dir, "page.pdf");
    await writeFile(source, html, "utf8");
    try {
      await execute("chromium", [
        "--headless", "--no-sandbox", "--disable-dev-shm-usage",
        "--disable-background-networking", "--print-to-pdf-no-header",
        "--print-to-pdf=" + output, "file://" + source,
      ], { timeout: 45000, killSignal: "SIGKILL" });
    } catch {
      await execute("libreoffice", [
        "-env:UserInstallation=file://" + join(dir, "profile"),
        "--headless", "--convert-to", "pdf", "--outdir", dir, source,
      ], { timeout: 45000, killSignal: "SIGKILL" });
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
