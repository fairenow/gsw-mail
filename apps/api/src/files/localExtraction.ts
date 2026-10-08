import { inflateSync } from "node:zlib";

const decodePdfLiteral = (value: string): string => {
  let output = "";
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]!;
    if (char !== "\\") {
      output += char;
      continue;
    }
    const next = value[++index];
    if (next === undefined) break;
    if (next === "n") output += "\n";
    else if (next === "r") output += "\r";
    else if (next === "t") output += "\t";
    else if (next === "b") output += "\b";
    else if (next === "f") output += "\f";
    else if (next === "\n") continue;
    else if (/[0-7]/.test(next)) {
      let octal = next;
      for (let count = 0; count < 2 && /[0-7]/.test(value[index + 1] ?? ""); count += 1) {
        octal += value[++index]!;
      }
      output += String.fromCharCode(Number.parseInt(octal, 8));
    } else output += next;
  }
  return output;
};

const decodeHex = (value: string): string => {
  const clean = value.replace(/\s+/g, "");
  if (!clean) return "";
  const padded = clean.length % 2 ? `${clean}0` : clean;
  const bytes = Buffer.from(padded, "hex");
  const utf16 = bytes.length >= 2 && ((bytes[0] === 0xfe && bytes[1] === 0xff) || (bytes[0] === 0xff && bytes[1] === 0xfe));
  if (utf16) {
    const be = bytes[0] === 0xfe;
    const chars: number[] = [];
    for (let i = 2; i + 1 < bytes.length; i += 2) chars.push(be ? bytes.readUInt16BE(i) : bytes.readUInt16LE(i));
    return String.fromCharCode(...chars);
  }
  return bytes.toString("latin1");
};

const cleanExtractedText = (value: string): string => value
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
  .replace(/[ \t]+/g, " ")
  .replace(/\n[ \t]+/g, "\n")
  .replace(/\n{3,}/g, "\n\n")
  .trim();

const extractOperators = (content: string): string[] => {
  const pieces: string[] = [];
  const literal = /\(((?:\\.|[^\\)])*)\)\s*(?:Tj|'|")/g;
  let match: RegExpExecArray | null;
  while ((match = literal.exec(content)) !== null) pieces.push(decodePdfLiteral(match[1] ?? ""));

  const arrays = /\[((?:.|\n|\r)*?)\]\s*TJ/g;
  while ((match = arrays.exec(content)) !== null) {
    const inner = match[1] ?? "";
    const parts: string[] = [];
    const token = /\(((?:\\.|[^\\)])*)\)|<([0-9a-fA-F\s]+)>/g;
    let item: RegExpExecArray | null;
    while ((item = token.exec(inner)) !== null) {
      parts.push(item[1] !== undefined ? decodePdfLiteral(item[1]) : decodeHex(item[2] ?? ""));
    }
    if (parts.length) pieces.push(parts.join(""));
  }

  const hex = /<([0-9a-fA-F\s]{4,})>\s*Tj/g;
  while ((match = hex.exec(content)) !== null) pieces.push(decodeHex(match[1] ?? ""));
  return pieces.filter((piece) => piece.trim());
};

export function extractPdfText(bytes: Buffer, maxChars = 120_000): string {
  if (!bytes.subarray(0, 5).toString("ascii").startsWith("%PDF-")) {
    throw new Error("file does not appear to be a PDF");
  }

  const raw = bytes.toString("latin1");
  const pieces: string[] = [];

  // Extract visible text operators from uncompressed content first.
  pieces.push(...extractOperators(raw));

  // Then inspect PDF streams, inflating the common FlateDecode streams.
  const streamPattern = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let streamMatch: RegExpExecArray | null;
  while ((streamMatch = streamPattern.exec(raw)) !== null && pieces.join("\n").length < maxChars) {
    const streamText = streamMatch[1] ?? "";
    const dictionaryStart = Math.max(0, streamMatch.index - 1200);
    const dictionary = raw.slice(dictionaryStart, streamMatch.index);
    let decoded = streamText;
    if (/\/FlateDecode\b/.test(dictionary)) {
      try {
        decoded = inflateSync(Buffer.from(streamText, "latin1")).toString("latin1");
      } catch {
        continue;
      }
    }
    pieces.push(...extractOperators(decoded));
  }

  const text = cleanExtractedText(pieces.join("\n"));
  if (!text) {
    throw new Error("No extractable text was found in this PDF. It may be scanned/image-only or use an unsupported embedded font encoding.");
  }
  return text.slice(0, maxChars);
}
