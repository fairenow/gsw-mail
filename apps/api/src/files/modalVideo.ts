import { config } from "../config.js";
import { HttpError } from "../lib/errors.js";

export type ModalVideoModel = "ltx-2.5" | "wan-2.2" | "hunyuan-video-1.5";
const definitions: Record<ModalVideoModel, { env: string; remoteModel: string }> = {
  "ltx-2.5": { env: "LTX_BASE_URL", remoteModel: "Lightricks/LTX-2.5" },
  "wan-2.2": { env: "WAN_BASE_URL", remoteModel: "Wan-AI/Wan2.2-TI2V-5B" },
  "hunyuan-video-1.5": { env: "HUNYUAN_BASE_URL", remoteModel: "tencent/HunyuanVideo-1.5" },
};

export function configuredVideoModels(): ModalVideoModel[] {
  if (!config.ai.modalProxyToken) return [];
  return (Object.keys(definitions) as ModalVideoModel[]).filter((model) => !!process.env[definitions[model].env]);
}

/** The supplied endpoint may be a root URL or a complete /v1/videos URL. */
export function videoCollectionUrl(model: ModalVideoModel): URL {
  const source = process.env[definitions[model].env];
  if (!source) throw new HttpError(503, "This video model is not configured.");
  const url = new URL(source);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new HttpError(503, "The configured video endpoint is invalid.");
  }
  const path = url.pathname.replace(/\/$/, "");
  url.pathname = path.endsWith("/v1/videos") ? path : path.endsWith("/v1") ? path + "/videos" : path + "/v1/videos";
  return url;
}

export interface VideoJob {
  id: string;
  status: "queued" | "processing" | "completed" | "failed";
}

function interpretJob(value: unknown): VideoJob {
  if (!value || typeof value !== "object") throw new HttpError(502, "The video provider returned an invalid job.");
  const data = value as Record<string, unknown>;
  const raw = data.data && typeof data.data === "object" ? data.data as Record<string, unknown> : data;
  const id = raw.id ?? raw.job_id ?? raw.task_id;
  const state = String(raw.status ?? raw.state ?? "queued").toLowerCase();
  if (typeof id !== "string" || !/^[a-z0-9_-]{1,160}$/i.test(id)) throw new HttpError(502, "The video provider returned an invalid job ID.");
  const status: VideoJob["status"] = ["completed", "succeeded", "success", "done"].includes(state)
    ? "completed" : ["failed", "error", "cancelled"].includes(state)
      ? "failed" : ["processing", "running", "in_progress", "generating"].includes(state) ? "processing" : "queued";
  return { id, status };
}

async function request(url: URL, options: RequestInit): Promise<Response> {
  const token = config.ai.modalProxyToken;
  if (!token) throw new HttpError(503, "Modal video generation is not configured.");
  const response = await fetch(url, {
    ...options,
    headers: { ...(options.headers as Record<string, string> | undefined), Authorization: "Bearer " + token },
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new HttpError(response.status === 429 ? 429 : 502, "Video generation service is unavailable.");
  return response;
}

export async function submitModalVideo(input: { model: ModalVideoModel; prompt: string; idempotencyKey: string }): Promise<VideoJob> {
  const collection = videoCollectionUrl(input.model);
  const response = await request(collection, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": input.idempotencyKey },
    body: JSON.stringify({ model: definitions[input.model].remoteModel, prompt: input.prompt }),
  });
  return interpretJob(await response.json());
}

function jobUrl(model: ModalVideoModel, jobId: string, suffix = ""): URL {
  if (!/^[a-z0-9_-]{1,160}$/i.test(jobId)) throw new HttpError(400, "Invalid video job identifier.");
  const url = videoCollectionUrl(model);
  url.pathname += "/" + encodeURIComponent(jobId) + suffix;
  return url;
}

export async function pollModalVideo(model: ModalVideoModel, jobId: string): Promise<VideoJob> {
  const response = await request(jobUrl(model, jobId), { method: "GET" });
  return interpretJob(await response.json());
}

export async function downloadModalVideo(model: ModalVideoModel, jobId: string): Promise<Buffer> {
  const response = await request(jobUrl(model, jobId, "/content"), { method: "GET" });
  const mime = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (mime !== "video/mp4" && mime !== "application/octet-stream") throw new HttpError(502, "Video provider returned an unexpected format.");
  const sizeHeader = Number(response.headers.get("content-length") ?? 0);
  if (sizeHeader > config.files.maxUploadBytes) throw new HttpError(413, "Generated video exceeds the GSW Files upload limit.");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 16 || bytes.length > config.files.maxUploadBytes || bytes.toString("ascii", 4, 8) !== "ftyp") {
    throw new HttpError(502, "Generated MP4 did not pass validation.");
  }
  return bytes;
}
