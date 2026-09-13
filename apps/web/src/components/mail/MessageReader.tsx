import type { FullMessage } from "../../api";
import { SenderAvatar } from "./SenderAvatar";

const fmtDate = (value: string) => new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
const stripHtml = (value: string) => value.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>|<[^>]+>/gi, "").trim();

export function MessageReader({ message, accountAddress, onBack, onReply, onReplyAll, onForward, onArchive, onTrash }: {
  message: FullMessage;
  accountAddress?: string;
  onBack: () => void;
  onReply: () => void;
  onReplyAll: () => void;
  onForward: () => void;
  onArchive: () => void;
  onTrash: () => void;
}) {
  const body = message.textBody?.trim() || (message.htmlBody ? stripHtml(message.htmlBody) : "");
  const recipientLabel = message.to?.map((recipient) => recipient.name || recipient.email).join(", ") || accountAddress || "your mailbox";

  return (
    <article className="gsw-reading-inner">
      <button className="gsw-reader-back" onClick={onBack}>← Back to messages</button>
      <h2 className="gsw-reading-subject">{message.subject || "(no subject)"}</h2>
      <div className="gsw-reading-from"><SenderAvatar size="large" name={message.from?.name} email={message.from?.email} /><div><strong>{message.from?.name || message.from?.email || "Unknown sender"}</strong><span>{message.from?.email || ""}</span></div><time className="gsw-reading-time" dateTime={message.date}>{fmtDate(message.date)}</time></div>
      <p className="gsw-reading-recipient">To {recipientLabel}</p>
      <div className="gsw-toolbar" aria-label="Message actions">
        <button onClick={onReply}>↩ <span>Reply</span></button>
        <button onClick={onReplyAll}>↩ <span>Reply all</span></button>
        <button onClick={onForward}>↪ <span>Forward</span></button>
        <button onClick={onArchive}>▣ <span>Archive</span></button>
        <button onClick={onTrash}>⌫ <span>Delete</span></button>
        <button aria-label="More message actions">⋯</button>
      </div>
      <div className="gsw-reading-body">{body || <span className="gsw-body-empty">This message has no readable body.</span>}</div>
      {!!message.attachments?.length && <div className="gsw-attachments"><h3>Attachments</h3>{message.attachments.map((attachment) => <div className="gsw-attachment" key={attachment.engineId}><span className="gsw-att-icon" aria-hidden="true">▤</span><div><strong>{attachment.filename}</strong><span>{formatBytes(attachment.size)} · {attachment.contentType}</span></div><span className="gsw-attachment-action">Download</span></div>)}</div>}
      <div className="gsw-reader-bottom-actions"><button className="gsw-secondary-btn" onClick={onReply}>↩ Reply</button><button className="gsw-secondary-btn" onClick={onForward}>↪ Forward</button></div>
    </article>
  );
}

const formatBytes = (size: number) => size < 1024 ? `${size} B` : size < 1024 * 1024 ? `${Math.round(size / 1024)} KB` : `${(size / (1024 * 1024)).toFixed(1)} MB`;
