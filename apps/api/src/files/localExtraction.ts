import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
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
      "pdf",
      "--outdir",
      dir,
      inputPath,
    ], 120_000);

    const files = await readdir(dir);
    const pdf = files.find((name) => name.toLowerCase().endsWith(".pdf"));
    if (!pdf) throw new Error("LibreOffice could not render this document.");
    const outputPath = join(dir, "document.txt");
    await run("pdftotext", ["-layout", "-enc", "UTF-8", join(dir, pdf), outputPath], 60_000);
    const text = cap(await readFile(outputPath, "utf8"), maxChars);
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

export type ExtractedVideoFrame = {
  timestampSeconds: number;
  bytes: Buffer;
  mimeType: "image/jpeg";
  ocrText: string;
};

export type LocalVideoInspection = {
  text: string;
  metadata: string;
  durationSeconds: number | null;
  frames: ExtractedVideoFrame[];
};

const parseVideoDuration = (metadata: string): number | null => {
  try {
    const parsed = JSON.parse(metadata) as {
      format?: { duration?: string | number };
      streams?: Array<{ duration?: string | number; codec_type?: string }>;
    };
    const candidates = [
      parsed.format?.duration,
      ...(parsed.streams ?? []).filter((stream) => stream.codec_type === "video").map((stream) => stream.duration),
    ];
    for (const value of candidates) {
      const duration = Number(value);
      if (Number.isFinite(duration) && duration > 0) return duration;
    }
  } catch {
    // Keep best-effort behavior when ffprobe output is malformed.
  }
  return null;
};

const representativeTimestamps = (durationSeconds: number | null, maxFrames = 8): number[] => {
  if (!durationSeconds || durationSeconds <= 0) return [0];
  if (durationSeconds <= 2) return [Math.max(0, durationSeconds / 2)];

  // Mirrors the successful strategy in flmlnk: sample across the full timeline
  // instead of taking only the first N frames or a fixed every-30-second cadence.
  const count = Math.min(maxFrames, Math.max(3, Math.ceil(durationSeconds / 20)));
  const edge = Math.min(0.5, durationSeconds * 0.02);
  const usable = Math.max(0.1, durationSeconds - edge * 2);
  return Array.from({ length: count }, (_, index) => {
    const ratio = count === 1 ? 0.5 : index / (count - 1);
    return Number((edge + usable * ratio).toFixed(3));
  });
};

export async function inspectVideoLocallyDetailed(input: {
  filename: string;
  bytes: Buffer;
  maxChars?: number;
}): Promise<LocalVideoInspection> {
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

    const durationSeconds = parseVideoDuration(metadata);
    const timestamps = representativeTimestamps(durationSeconds);
    const frames: ExtractedVideoFrame[] = [];

    for (const [index, timestampSeconds] of timestamps.entries()) {
      const framePath = join(dir, `frame-${String(index + 1).padStart(2, "0")}.jpg`);
      try {
        await run("ffmpeg", [
          "-hide_banner", "-loglevel", "error",
          "-ss", String(timestampSeconds),
          "-i", inputPath,
          "-frames:v", "1",
          "-vf", "scale='min(960,iw)':-2",
          "-q:v", "4",
          framePath,
        ], 60_000);

        let ocrText = "";
        try {
          const result = await run("tesseract", [framePath, "stdout", "--psm", "6"], 45_000);
          ocrText = result.stdout.trim();
        } catch {
          ocrText = "";
        }

        frames.push({
          timestampSeconds,
          bytes: await readFile(framePath),
          mimeType: "image/jpeg",
          ocrText,
        });
      } catch {
        // A single bad timestamp/frame must not make the whole video unreadable.
      }
    }

    const frameNotes = frames.map((frame, index) =>
      `[FRAME ${index + 1} @ ${frame.timestampSeconds.toFixed(1)}s] ${frame.ocrText || "No readable on-screen text detected."}`,
    );

    const text = cap([
      "[VIDEO METADATA]",
      metadata,
      "",
      "[REPRESENTATIVE FRAME OCR]",
      frameNotes.length ? frameNotes.join("\n\n") : "No representative frames could be extracted.",
    ].join("\n"), maxChars);

    return { text, metadata, durationSeconds, frames };
  });
}

export async function inspectVideoLocally(input: {
  filename: string;
  bytes: Buffer;
  maxChars?: number;
}): Promise<string> {
  return (await inspectVideoLocallyDetailed(input)).text;
}
