import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join, parse } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const cleanExtractedText = (value: string): string => value
  .replace(/\u0000/g, "")
  .replace(/[ \t]+/g, " ")
  .replace(/\n[ \t]+/g, "\n")
  .replace(/\n{3,}/g, "\n\n")
  .trim();

const cap = (value: string, maxChars: number) => cleanExtractedText(value).slice(0, maxChars);

const withTempDir = async <T>(prefix: string, work: (dir: string) => Promise<T>): Promise<T> => {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  try {
    return await work(dir);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
};

const run = async (command: string, args: string[], timeout = 60_000) => {
  try {
    return await execFileAsync(command, args, {
      timeout,
      maxBuffer: 8 * 1024 * 1024,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/ENOENT/.test(message)) throw new Error(`${command} is unavailable on this server.`);
    throw error;
  }
};

export async function extractPdfText(bytes: Buffer, maxChars = 120_000): Promise<string> {
  if (!bytes.subarray(0, 5).toString("ascii").startsWith("%PDF-")) {
    throw new Error("file does not appear to be a PDF");
  }

  return withTempDir("gsw-pdf-", async (dir) => {
    const inputPath = join(dir, "input.pdf");
    const outputPath = join(dir, "output.txt");
    await writeFile(inputPath, bytes);
    await run("pdftotext", ["-layout", "-enc", "UTF-8", inputPath, outputPath], 45_000);
    const text = cap(await readFile(outputPath, "utf8"), maxChars);
    if (!text) throw new Error("No extractable text was found in this PDF. It may be scanned/image-only.");
    return text;
  });
}

export async function extractOfficeDocumentText(input: {
  filename: string;
  bytes: Buffer;
  maxChars?: number;
}): Promise<string> {
  const maxChars = input.maxChars ?? 120_000;
  return withTempDir("gsw-doc-", async (dir) => {
    const extension = extname(input.filename) || ".docx";
    const inputPath = join(dir, `input${extension}`);
    await writeFile(inputPath, input.bytes);

    await run("libreoffice", [
      "--headless",
      "--convert-to",
      "txt:Text",
      "--outdir",
      dir,
      inputPath,
    ], 90_000);

    const files = await readdir(dir);
    const txt = files.find((name) => name.toLowerCase().endsWith(".txt"));
    if (!txt) throw new Error("LibreOffice could not convert this document to text.");
    const text = cap(await readFile(join(dir, txt), "utf8"), maxChars);
    if (!text) throw new Error("No readable text was extracted from this document.");
    return text;
  });
}

export async function extractPresentationText(input: {
  filename: string;
  bytes: Buffer;
  maxChars?: number;
}): Promise<string> {
  const maxChars = input.maxChars ?? 120_000;
  return withTempDir("gsw-ppt-", async (dir) => {
    const extension = extname(input.filename) || ".pptx";
    const inputPath = join(dir, `input${extension}`);
    await writeFile(inputPath, input.bytes);

    await run("libreoffice", [
      "--headless",
      "--convert-to",
      "pdf",
      "--outdir",
      dir,
      inputPath,
    ], 120_000);

    const files = await readdir(dir);
    const pdf = files.find((name) => name.toLowerCase().endsWith(".pdf"));
    if (!pdf) throw new Error("LibreOffice could not render this presentation.");
    const outputPath = join(dir, "slides.txt");
    await run("pdftotext", ["-layout", "-enc", "UTF-8", join(dir, pdf), outputPath], 60_000);
    const text = cap(await readFile(outputPath, "utf8"), maxChars);
    if (!text) throw new Error("No readable slide text was extracted from this presentation.");
    return text;
  });
}

const workbookScript = String.raw`
import json, sys, openpyxl
path = sys.argv[1]
wb = openpyxl.load_workbook(path, read_only=True, data_only=False)
out = []
for ws in wb.worksheets:
    out.append(f"=== SHEET: {ws.title} ===")
    rows = 0
    for row in ws.iter_rows():
        vals = []
        populated = False
        for cell in row:
            v = cell.value
            if v is not None:
                populated = True
            if isinstance(v, str):
                vals.append(v)
            elif v is None:
                vals.append("")
            else:
                vals.append(str(v))
        if populated:
            out.append("\\t".join(vals))
            rows += 1
        if rows >= 5000:
            out.append("[sheet truncated after 5000 populated rows]")
            break
print("\\n".join(out))
`;

export async function extractSpreadsheetText(input: {
  filename: string;
  bytes: Buffer;
  maxChars?: number;
}): Promise<string> {
  const maxChars = input.maxChars ?? 160_000;
  return withTempDir("gsw-sheet-", async (dir) => {
    const originalExt = extname(input.filename).toLowerCase() || ".xlsx";
    let inputPath = join(dir, `input${originalExt}`);
    await writeFile(inputPath, input.bytes);

    if (![".xlsx", ".xlsm"].includes(originalExt)) {
      await run("libreoffice", [
        "--headless",
        "--convert-to",
        "xlsx",
        "--outdir",
        dir,
        inputPath,
      ], 120_000);
      const files = await readdir(dir);
      const converted = files.find((name) => name.toLowerCase().endsWith(".xlsx"));
      if (!converted) throw new Error("LibreOffice could not convert this spreadsheet to XLSX.");
      inputPath = join(dir, converted);
    }

    const { stdout } = await run("python3", ["-c", workbookScript, inputPath], 120_000);
    const text = cap(stdout, maxChars);
    if (!text) throw new Error("No readable cells were extracted from this spreadsheet.");
    return text;
  });
}

export async function inspectImageLocally(input: {
  filename: string;
  bytes: Buffer;
  maxChars?: number;
}): Promise<string> {
  const maxChars = input.maxChars ?? 60_000;
  return withTempDir("gsw-image-", async (dir) => {
    const extension = extname(input.filename) || ".img";
    const inputPath = join(dir, `input${extension}`);
    const normalizedPath = join(dir, "normalized.png");
    await writeFile(inputPath, input.bytes);

    let metadata = "";
    try {
      const result = await run("identify", ["-format", "%m %wx%h %[EXIF:Orientation]", inputPath], 30_000);
      metadata = result.stdout.trim();
    } catch {
      metadata = "Image metadata unavailable";
    }

    await run("convert", [inputPath + "[0]", "-auto-orient", "-resize", "2200x2200>", normalizedPath], 60_000);
    let ocr = "";
    try {
      const result = await run("tesseract", [normalizedPath, "stdout", "--psm", "6"], 90_000);
      ocr = result.stdout.trim();
    } catch {
      ocr = "";
    }

    return cap([
      `[IMAGE METADATA] ${metadata || "unknown"}`,
      ocr ? `[OCR TEXT]\n${ocr}` : "[OCR TEXT] No readable text detected.",
    ].join("\n\n"), maxChars);
  });
}

export async function inspectVideoLocally(input: {
  filename: string;
  bytes: Buffer;
  maxChars?: number;
}): Promise<string> {
  const maxChars = input.maxChars ?? 80_000;
  return withTempDir("gsw-video-", async (dir) => {
    const extension = extname(input.filename) || ".mp4";
    const inputPath = join(dir, `input${extension}`);
    await writeFile(inputPath, input.bytes);

    let metadata = "";
    try {
      const result = await run("ffprobe", [
        "-v", "quiet",
        "-print_format", "json",
        "-show_format",
        "-show_streams",
        inputPath,
      ], 45_000);
      metadata = result.stdout.trim();
    } catch {
      metadata = "Video metadata unavailable";
    }

    const framePattern = join(dir, "frame-%02d.png");
    try {
      await run("ffmpeg", [
        "-hide_banner", "-loglevel", "error",
        "-i", inputPath,
        "-vf", "fps=1/30,scale='min(1280,iw)':-2",
        "-frames:v", "6",
        framePattern,
      ], 120_000);
    } catch {
      // Metadata is still useful even when frame extraction fails.
    }

    const files = (await readdir(dir)).filter((name) => /^frame-\d+\.png$/i.test(name)).sort();
    const frameNotes: string[] = [];
    for (const [index, file] of files.entries()) {
      let ocr = "";
      try {
        const result = await run("tesseract", [join(dir, file), "stdout", "--psm", "6"], 45_000);
        ocr = result.stdout.trim();
      } catch {
        ocr = "";
      }
      frameNotes.push(`[FRAME ${index + 1}] ${ocr || "No readable on-screen text detected."}`);
    }

    return cap([
      "[VIDEO METADATA]",
      metadata,
      "",
      "[REPRESENTATIVE FRAME OCR]",
      frameNotes.length ? frameNotes.join("\n\n") : "No representative frames could be extracted.",
      "",
      "[LIMITATION]",
      "This local fallback inspects metadata and representative frame text. Full visual-semantic understanding and speech transcription require a compatible multimodal/transcription model.",
    ].join("\n"), maxChars);
  });
}
