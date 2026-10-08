export type FileCategory =
  | "text"
  | "pdf"
  | "document"
  | "spreadsheet"
  | "presentation"
  | "image"
  | "audio"
  | "video"
  | "archive"
  | "email"
  | "calendar"
  | "ebook"
  | "code"
  | "binary";

export type FileAnalysisStrategy =
  | "text"
  | "openai_file"
  | "vision"
  | "transcription"
  | "video"
  | "code_interpreter"
  | "best_effort";

const ext = (filename: string) => filename.split(".").pop()?.toLowerCase() ?? "";

const TEXT_EXTENSIONS = new Set([
  "txt","md","markdown","csv","tsv","json","jsonl","xml","html","htm","yaml","yml","toml","ini","cfg","conf","log",
  "ics","vcf","srt","vtt","tex","rst"
]);
const CODE_EXTENSIONS = new Set([
  "js","jsx","ts","tsx","mjs","cjs","py","rb","php","java","kt","kts","swift","go","rs","c","cc","cpp","cxx","h","hpp",
  "cs","fs","fsx","scala","sh","bash","zsh","fish","ps1","sql","graphql","gql","css","scss","sass","less","vue","svelte",
  "dockerfile","makefile","gradle","properties","env","ipynb"
]);
const PDF_EXTENSIONS = new Set(["pdf"]);
const DOCUMENT_EXTENSIONS = new Set(["doc","docx","rtf"]);
const ALT_DOCUMENT_EXTENSIONS = new Set(["odt","pages"]);
const SPREADSHEET_EXTENSIONS = new Set(["xls","xlsx","xlsm","xlsb"]);
const ALT_SPREADSHEET_EXTENSIONS = new Set(["ods","numbers"]);
const PRESENTATION_EXTENSIONS = new Set(["ppt","pptx"]);
const ALT_PRESENTATION_EXTENSIONS = new Set(["odp","key","keynote"]);
const VISION_IMAGE_EXTENSIONS = new Set(["png","jpg","jpeg","webp","gif"]);
const CONVERT_IMAGE_EXTENSIONS = new Set(["bmp","tif","tiff","heic","heif","avif","svg","ico"]);
const AUDIO_EXTENSIONS = new Set(["flac","mp3","mpga","m4a","ogg","oga","wav","aac","wma"]);
const VIDEO_EXTENSIONS = new Set(["mp4","mpeg","mpg","webm","m4v","mov","mkv","avi"]);
const ARCHIVE_EXTENSIONS = new Set(["zip","tar","tgz","gz","bz2","xz","7z","rar"]);
const EMAIL_EXTENSIONS = new Set(["eml","msg"]);
const EBOOK_EXTENSIONS = new Set(["epub","mobi","azw","azw3"]);

export function detectFileType(filename: string, mimeType = "application/octet-stream"): {
  extension: string;
  category: FileCategory;
  strategy: FileAnalysisStrategy;
  kind: string;
  textLike: boolean;
  note?: string;
} {
  const extension = ext(filename);
  const mime = mimeType.toLowerCase();

  if (TEXT_EXTENSIONS.has(extension) || mime.startsWith("text/") || ["application/json","application/xml","application/javascript","application/x-yaml"].includes(mime)) {
    const category: FileCategory = extension === "ics" || extension === "vcf" ? "calendar" : "text";
    return { extension, category, strategy: "text", kind: category === "calendar" ? "document" : "document", textLike: true };
  }
  if (CODE_EXTENSIONS.has(extension)) {
    return { extension, category: "code", strategy: "text", kind: "document", textLike: true };
  }
  if (PDF_EXTENSIONS.has(extension) || mime === "application/pdf") {
    return { extension, category: "pdf", strategy: "openai_file", kind: "pdf", textLike: false };
  }
  if (mime.startsWith("video/")) {
    return {
      extension,
      category: "video",
      strategy: "video",
      kind: "video",
      textLike: false,
      note: "Video analysis uses the audio track plus best-effort computational inspection of frames/metadata.",
    };
  }
  if (mime.startsWith("audio/")) {
    return { extension, category: "audio", strategy: "transcription", kind: "audio", textLike: false };
  }
  if (SPREADSHEET_EXTENSIONS.has(extension) || /spreadsheetml|ms-excel/.test(mime)) {
    return { extension, category: "spreadsheet", strategy: "code_interpreter", kind: "spreadsheet", textLike: false };
  }
  if (ALT_SPREADSHEET_EXTENSIONS.has(extension) || /opendocument\.spreadsheet/.test(mime)) {
    return { extension, category: "spreadsheet", strategy: "code_interpreter", kind: "spreadsheet", textLike: false };
  }
  if (PRESENTATION_EXTENSIONS.has(extension) || /presentationml|ms-powerpoint/.test(mime)) {
    return { extension, category: "presentation", strategy: "openai_file", kind: "presentation", textLike: false };
  }
  if (ALT_PRESENTATION_EXTENSIONS.has(extension) || /opendocument\.presentation/.test(mime)) {
    return { extension, category: "presentation", strategy: "code_interpreter", kind: "presentation", textLike: false };
  }
  if (DOCUMENT_EXTENSIONS.has(extension) || /wordprocessingml|msword|rtf/.test(mime)) {
    return { extension, category: "document", strategy: "openai_file", kind: "document", textLike: false };
  }
  if (ALT_DOCUMENT_EXTENSIONS.has(extension) || /opendocument\.text/.test(mime)) {
    return { extension, category: "document", strategy: "code_interpreter", kind: "document", textLike: false };
  }
  if (VISION_IMAGE_EXTENSIONS.has(extension) || /^image\/(png|jpeg|jpg|webp|gif)$/.test(mime)) {
    return { extension, category: "image", strategy: "vision", kind: "image", textLike: false };
  }
  if (CONVERT_IMAGE_EXTENSIONS.has(extension) || mime.startsWith("image/")) {
    return {
      extension,
      category: "image",
      strategy: "code_interpreter",
      kind: "image",
      textLike: false,
      note: "This image format is converted or inspected in the computational workspace before analysis.",
    };
  }
  if (AUDIO_EXTENSIONS.has(extension)) {
    return { extension, category: "audio", strategy: "transcription", kind: "audio", textLike: false };
  }
  if (VIDEO_EXTENSIONS.has(extension)) {
    return {
      extension,
      category: "video",
      strategy: "video",
      kind: "video",
      textLike: false,
      note: "Video analysis uses the audio track plus best-effort computational inspection of frames/metadata.",
    };
  }
  if (EBOOK_EXTENSIONS.has(extension) || mime === "application/epub+zip") {
    return { extension, category: "ebook", strategy: "code_interpreter", kind: "document", textLike: false };
  }
  if (ARCHIVE_EXTENSIONS.has(extension) || /zip|gzip|x-7z|x-rar|x-tar|bzip|xz/.test(mime)) {
    return { extension, category: "archive", strategy: "code_interpreter", kind: "archive", textLike: false };
  }
  if (EMAIL_EXTENSIONS.has(extension) || mime === "message/rfc822") {
    return { extension, category: "email", strategy: extension === "eml" ? "text" : "code_interpreter", kind: "document", textLike: extension === "eml" };
  }

  return {
    extension,
    category: "binary",
    strategy: "best_effort",
    kind: "file",
    textLike: false,
    note: "Unknown binary formats are stored and attached normally and receive best-effort sandbox analysis when requested.",
  };
}

export function isTextLikeFile(filename: string, mimeType?: string | null) {
  return detectFileType(filename, mimeType || "application/octet-stream").textLike;
}

export const supportedFileTypeSummary = {
  text: [...TEXT_EXTENSIONS, ...CODE_EXTENSIONS],
  documents: [...PDF_EXTENSIONS, ...DOCUMENT_EXTENSIONS, ...ALT_DOCUMENT_EXTENSIONS],
  spreadsheets: [...SPREADSHEET_EXTENSIONS, ...ALT_SPREADSHEET_EXTENSIONS],
  presentations: [...PRESENTATION_EXTENSIONS, ...ALT_PRESENTATION_EXTENSIONS],
  images: [...VISION_IMAGE_EXTENSIONS, ...CONVERT_IMAGE_EXTENSIONS],
  audio: [...AUDIO_EXTENSIONS],
  video: [...VIDEO_EXTENSIONS],
  archives: [...ARCHIVE_EXTENSIONS],
  email: [...EMAIL_EXTENSIONS],
  ebooks: [...EBOOK_EXTENSIONS],
};
