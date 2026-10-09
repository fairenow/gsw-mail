import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { timingSafeEqual } from "node:crypto";

const exec = promisify(execFile);
const port = Number(process.env.PORT || 4001);
const secret = process.env.PDF_RENDER_TOKEN;
if (!secret || secret.length < 32) throw new Error("PDF_RENDER_TOKEN must be configured");
let busy = false;
const validToken = (candidate) => {
  if (!candidate || Buffer.byteLength(candidate) !== Buffer.byteLength(secret)) return false;
  return timingSafeEqual(Buffer.from(candidate), Buffer.from(secret));
};
function send(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}
const server = createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") return send(res, 200, { ok: true });
  if (req.method !== "POST" || req.url !== "/render") return send(res, 404, { error: "not_found" });
  if (!validToken(req.headers.authorization?.replace(/^Bearer /, ""))) return send(res, 401, { error: "unauthorized" });
  if (busy) return send(res, 503, { error: "busy" });
  if (!/^application\/json(?:;|$)/i.test(req.headers["content-type"] || "")) return send(res, 415, { error: "unsupported_media" });
  busy = true;
  let dir;
  try {
    const chunks = [];
    let total = 0;
    for await (const chunk of req) {
      total += chunk.length;
      if (total > 850_000) throw new Error("input_limit");
      chunks.push(chunk);
    }
    const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (typeof payload.html !== "string" || payload.html.length > 600_000) throw new Error("invalid_html");
    // Defense in depth; the API already enforces the full printable-HTML policy.
    if (/<(?:script|iframe|object|embed|link|base|form)\b|\bon[a-z]+\s*=|@import\b|url\s*\(|\b(?:href|action)\s*=/i.test(payload.html)) throw new Error("unsafe_html");
    if ([...payload.html.matchAll(/\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)]
      .some((m) => !/^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/i.test(m[1] ?? m[2] ?? m[3] ?? ""))) throw new Error("unsafe_image");
    dir = await mkdtemp(join(tmpdir(), "gsw-isolated-pdf-"));
    await writeFile(join(dir, "page.html"), payload.html, "utf8");
    const output = join(dir, "page.pdf");
    await exec("chromium", [
      "--headless", "--no-sandbox", "--disable-setuid-sandbox",
      "--disable-dev-shm-usage", "--disable-background-networking",
      "--disable-extensions", "--disable-default-apps", "--no-first-run",
      "--no-proxy-server", "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost",
      "--user-data-dir=" + join(dir, "profile"),
      "--print-to-pdf-no-header", "--print-to-pdf=" + output,
      "file://" + join(dir, "page.html"),
    ], { timeout: 45_000, killSignal: "SIGKILL", maxBuffer: 100_000 });
    const pdf = await readFile(output);
    if (pdf.length < 500 || pdf.length > 15_000_000 || pdf.toString("ascii", 0, 5) !== "%PDF-") throw new Error("invalid_pdf");
    const { stdout } = await exec("pdfinfo", [output], { timeout: 5000 });
    const pages = Number(stdout.match(/^Pages:\s+(\d+)/m)?.[1] ?? 0);
    if (!Number.isInteger(pages) || pages < 1 || pages > 30) throw new Error("invalid_pages");
    console.info(JSON.stringify({ event: "pdf.worker.rendered", pages, bytes: pdf.length }));
    res.writeHead(200, { "Content-Type": "application/pdf", "Cache-Control": "no-store" });
    res.end(pdf);
  } catch (error) {
    const code = ["input_limit", "invalid_html", "unsafe_html", "unsafe_image"].includes(error?.message) ? "invalid_input" : "render_failed";
    console.error(JSON.stringify({ event: "pdf.worker.failed", errorType: error instanceof Error ? error.name : "Unknown", code }));
    send(res, code === "invalid_input" ? 400 : 502, { error: code });
  } finally {
    busy = false;
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});
server.requestTimeout = 55_000;
server.listen(port, "0.0.0.0", () => console.info(JSON.stringify({ event: "pdf.worker.ready", port })));
