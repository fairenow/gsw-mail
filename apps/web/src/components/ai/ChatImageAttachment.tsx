import { useEffect, useState } from "react";
import { Download, Image as ImageIcon, MailPlus, RefreshCw } from "lucide-react";
import { api, type AiChatAttachment } from "../../api";

export const isChatImage = (attachment: AiChatAttachment) =>
  ["image/png", "image/jpeg", "image/webp"].includes(attachment.mimeType.toLowerCase());

export function ChatImageAttachment({ attachment, onUseInEmail, onError }: {
  attachment: AiChatAttachment;
  onUseInEmail: (attachment: AiChatAttachment) => void;
  onError: (message: string) => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setUrl(null);
    setState("loading");
    void api.fileDownload(attachment.assetId).then((data) => {
      if (!active) return;
      // Only short-lived, user-authorized URLs from the existing file API are used.
      const candidate = new URL(data.url);
      if (candidate.protocol !== "https:" && !(candidate.protocol === "http:" && candidate.hostname === "localhost")) throw new Error("Invalid image URL");
      setUrl(candidate.href);
      setState("ready");
    }).catch(() => { if (active) setState("error"); });
    return () => { active = false; };
  }, [attachment.assetId, revision]);

  const download = async () => {
    try {
      const result = await api.fileDownload(attachment.assetId);
      const link = document.createElement("a");
      link.href = result.url;
      link.download = attachment.filename;
      link.rel = "noopener noreferrer";
      link.click();
    } catch {
      onError("Unable to access this image. Please try again.");
    }
  };
  return <section className="gsw-chat-image-card" aria-label={attachment.filename}>
    <div className="gsw-chat-image-frame">
      {state === "loading" && <span role="status"><ImageIcon size={18} /> Loading image preview…</span>}
      {state === "error" && <span role="alert">Preview unavailable. <button type="button" onClick={() => setRevision((n) => n + 1)}><RefreshCw size={14} /> Retry</button></span>}
      {state === "ready" && url && <img src={url} alt={attachment.filename} loading="lazy" referrerPolicy="no-referrer" onError={() => { setState("error"); setUrl(null); }} />}
    </div>
    <div className="gsw-chat-image-meta"><strong>{attachment.filename}</strong><small>{attachment.mimeType} · {Math.round(attachment.sizeBytes / 1024)} KB</small></div>
    <div className="gsw-chat-image-actions">
      <button type="button" onClick={() => void download()}><Download size={14} /> Download</button>
      <button type="button" onClick={() => onUseInEmail(attachment)}><MailPlus size={14} /> Use in email</button>
    </div>
  </section>;
}
