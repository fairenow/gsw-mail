import { useEffect, useState } from "react";
import { Download, Expand, Film, LoaderCircle, X } from "lucide-react";
import { api, type AiChatAttachment } from "../../api";

const safeUrl = (raw: string) => {
  const value = new URL(raw);
  if (value.protocol !== "https:" && !(value.protocol === "http:" && value.hostname === "localhost")) throw new Error("Invalid media URL");
  return value.href;
};

export function MediaPreviewModal({ attachment, onClose }: { attachment: AiChatAttachment; onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const video = attachment.mimeType.toLowerCase() === "video/mp4";
  useEffect(() => {
    let active = true;
    void api.fileDownload(attachment.assetId).then((result) => {
      if (active) setUrl(safeUrl(result.url));
    }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [attachment.assetId]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);
  return <div className="gsw-media-preview-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div role="dialog" aria-modal="true" aria-label={"Preview " + attachment.filename} className="gsw-media-preview-dialog">
      <header><strong>{attachment.filename}</strong><button type="button" onClick={onClose} aria-label="Close preview"><X size={20}/></button></header>
      <div className="gsw-media-preview-body">
        {error ? <p>Preview unavailable. Please try again.</p> : !url ? <p role="status"><LoaderCircle size={18} className="gsw-chat-spin"/> Loading preview…</p> : video
          ? <video controls playsInline preload="metadata" src={url} /> : <img src={url} alt={attachment.filename} referrerPolicy="no-referrer" />}
      </div>
      {url && <footer><a href={url} target="_blank" rel="noopener noreferrer" download={attachment.filename}><Download size={16}/> Open or download</a></footer>}
    </div>
  </div>;
}

export function ChatVideoAttachment({ attachment, onPreview }: { attachment: AiChatAttachment; onPreview: (asset: AiChatAttachment) => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    void api.fileDownload(attachment.assetId).then((result) => {
      if (active) setUrl(safeUrl(result.url));
    }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [attachment.assetId]);
  return <section className="gsw-chat-video-card">
    <div className="gsw-chat-video-header"><Film size={18}/><strong>Video ready</strong></div>
    {url ? <video src={url} controls playsInline preload="metadata" aria-label={attachment.filename} /> : <p role="status">{failed ? "Video preview unavailable." : "Loading video…"}</p>}
    <div className="gsw-chat-video-actions"><span>{attachment.filename}</span><button type="button" onClick={() => onPreview(attachment)}><Expand size={15}/> Expand</button></div>
  </section>;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function ChatVideoTaskCard({ taskId, onPreview }: { taskId: string; onPreview: (asset: AiChatAttachment) => void }) {
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof api.chatTask>> | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!uuid.test(taskId)) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = async () => {
      try {
        const next = await api.chatTask(taskId);
        if (!active) return;
        setDetail(next); setFailed(false);
        if (!["completed", "failed", "cancelled"].includes(next.task.status)) timer = setTimeout(() => void check(), 9000);
      } catch {
        if (active) { setFailed(true); timer = setTimeout(() => void check(), 20000); }
      }
    };
    void check();
    return () => { active = false; if (timer) clearTimeout(timer); };
  }, [taskId]);
  const status = detail?.task.status ?? "planned";
  const outcome = detail?.steps.find((step) => typeof step.result?.assetId === "string")?.result;
  const attachment: AiChatAttachment | null = typeof outcome?.assetId === "string" && typeof outcome.filename === "string"
    ? { assetId: outcome.assetId, filename: outcome.filename, mimeType: "video/mp4", sizeBytes: typeof outcome.sizeBytes === "number" ? outcome.sizeBytes : 0 } : null;
  return <section className="gsw-chat-video-card" aria-live="polite">
    <div className="gsw-chat-video-header"><Film size={19}/><strong>{status === "completed" ? "Your video is ready" : status === "failed" || status === "cancelled" ? "Video generation stopped" : "Creating your video"}</strong></div>
    {attachment ? <ChatVideoAttachment attachment={attachment} onPreview={onPreview}/> :
      <div className="gsw-chat-video-pending">{status === "failed" || status === "cancelled" ? <p>We couldn't finish this video. You can try generating it again.</p> :
        <><LoaderCircle size={25} className="gsw-chat-spin"/><span>{failed ? "Checking generation status…" : "Preparing and rendering your clip. You can leave this chat and return later."}</span></>}</div>}
    {status !== "failed" && status !== "cancelled" && !attachment && <div className="gsw-chat-video-progress"><div style={{ width: Math.max(6, Math.min(100, detail?.task.progressPercent ?? 6)) + "%" }}/></div>}
    <small>{status === "completed" ? "Saved to your GSW Files" : status === "failed" ? "Generation failed" : "GSW will update this card automatically"}</small>
  </section>;
}

export function extractVideoTaskId(content: string): string | null {
  const match = content.match(/(?:task\s*ID\s*(?:is|:)?|task\s*#|video\s+task\s*ID)\s*[:#]?\s*\*{0,2}([0-9a-f-]{36})/i);
  return match && uuid.test(match[1] ?? "") ? match[1]! : null;
}
