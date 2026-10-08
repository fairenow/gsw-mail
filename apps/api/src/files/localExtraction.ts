import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const cleanExtractedText = (value: string): string => value
  .replace(/\u0000/g, "")
  .replace(/[ \t]+/g, " ")
  .replace(/\n[ \t]+/g, "\n")
  .replace(/\n{3,}/g, "\n\n")
  .trim();

export async function extractPdfText(bytes: Buffer, maxChars = 120_000): Promise<string> {
  if (!bytes.subarray(0, 5).toString("ascii").startsWith("%PDF-")) {
    throw new Error("file does not appear to be a PDF");
  }

  const token = randomUUID();
  const inputPath = join(tmpdir(), `gsw-pdf-${token}.pdf`);
  const outputPath = join(tmpdir(), `gsw-pdf-${token}.txt`);

  try {
    await writeFile(inputPath, bytes);
    await execFileAsync("pdftotext", ["-layout", "-enc", "UTF-8", inputPath, outputPath], {
      timeout: 45_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    const text = cleanExtractedText(await readFile(outputPath, "utf8"));
    if (!text) {
      throw new Error("No extractable text was found in this PDF. It may be scanned/image-only.");
    }
    return text.slice(0, maxChars);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/ENOENT|pdftotext/i.test(message)) {
      throw new Error("The local PDF extraction service is unavailable on this server.");
    }
    throw error;
  } finally {
    await Promise.all([
      unlink(inputPath).catch(() => undefined),
      unlink(outputPath).catch(() => undefined),
    ]);
  }
}
