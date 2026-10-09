/**
 * Pure PDF preflight policy. Parsed word-boxes come from local pdftotext -bbox
 * and never leave the isolated rendering worker.
 */
export function inspectPdfPages(pages) {
  const issues = [];
  for (const [index, page] of pages.entries()) {
    const words = page.words ?? [];
    const text = words.map((word) => word.text).join(" ");
    if (/file:\/\/\/tmp\/|gsw-isolated-pdf-|page\.html\b/i.test(text)) {
      issues.push({ page: index + 1, code: "internal_path", severity: "reject" });
    }
    const legitimate = words.filter((w) => !/^\d+\/\d+$/.test(w.text));
    if (legitimate.length < 20 && pages.length > 1) {
      issues.push({ page: index + 1, code: "sparse_page", severity: "warning" });
    }
    if (legitimate.length > 0) {
      const right = Math.max(...legitimate.map((w) => w.xMax));
      const left = Math.min(...legitimate.map((w) => w.xMin));
      const top = Math.min(...legitimate.map((w) => w.yMin));
      const bottom = Math.max(...legitimate.map((w) => w.yMax));
      if (left < 14 || top < 14 || right > page.width - 14 || bottom > page.height - 14) {
        issues.push({ page: index + 1, code: "text_near_edge", severity: "warning" });
      }
      if (index === 0 && pages.length > 1 && legitimate.length > 25 && bottom < page.height * 0.48) {
        issues.push({ page: 1, code: "underfilled_cover", severity: "warning" });
      }
      if (index === pages.length - 1 && pages.length > 1 && bottom < page.height * 0.32 && legitimate.length < 65) {
        issues.push({ page: index + 1, code: "sparse_final_page", severity: "warning" });
      }
    }
  }
  return { issues, reject: issues.some((issue) => issue.severity === "reject") };
}

export function extractWordBoxPages(xml) {
  const pages = [];
  for (const match of xml.matchAll(/<page\b([^>]*)>([\s\S]*?)<\/page>/gi)) {
    const attrs = match[1];
    const width = Number(attrs.match(/\bwidth="([\d.]+)"/)?.[1]);
    const height = Number(attrs.match(/\bheight="([\d.]+)"/)?.[1]);
    if (!width || !height) continue;
    const words = [];
    for (const w of match[2].matchAll(/<word\b([^>]*)>([\s\S]*?)<\/word>/gi)) {
      const get = (key) => Number(w[1].match(new RegExp('\\b' + key + '="([\\d.]+)"'))?.[1]);
      const text = w[2].replace(/<[^>]*>/g, "").replace(/&(?:amp|lt|gt|quot|apos);/g, (v) => ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'" })[v] ?? v);
      words.push({ text, xMin: get("xMin"), yMin: get("yMin"), xMax: get("xMax"), yMax: get("yMax") });
    }
    pages.push({ width, height, words });
  }
  return pages;
}
