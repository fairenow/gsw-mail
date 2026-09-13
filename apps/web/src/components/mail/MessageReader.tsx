import type { FullMessage } from "../../api";
import type { Folder } from "../folders";
import { SenderAvatar } from "./SenderAvatar";

const fmtDate = (value: string) => new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
const stripHtml = (value: string) => value.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>|<[^>]+>/gi, "").trim();
type BodyBlock = { kind: "normal" | "quote"; lines: string[] };

const bodyBlocks = (body: string): BodyBlock[] => body.split("\n").reduce<BodyBlock[]>((blocks, line) => {
  const quoted = /^\s*>/.test(line);
  const content = quoted ? line.replace(/^\s*(?:>\s?)+/, "") : line;
  const previous = blocks[blocks.length - 1];
  if (previous?.kind === (quoted ? "quote" : "normal")) previous.lines.push(content);
  else blocks.push({ kind: quoted ? "quote" : "normal", lines: [content] });
  return blocks;
}, []);

export function MessageReader({ message, accountAddress, folder, onBack, onReply, onReplyAll, onForward, onArchive, onTrash, onToggleRead, onRestore, onDestroy }: {
  message: FullMessage;
  accountAddress?: string;
  folder: Folder;
  onBack: () => void;
  onReply: () => void;
  onReplyAll: () => void;
  onForward: () => void;
  onArchive: () => void;
  onTrash: () => void;
  onToggleRead: () => void;
  onRestore: () => void;
  onDestroy: () => void;
}) {
  const body = message.textBody?.trim() || (message.htmlBody ? stripHtml(message.htmlBody) : "");
  const recipientLabel = message.to?.map((recipient) => recipient.name || recipient.email).join(", ") || accountAddress || "your mailbox";

  return (
    <article className="gsw-reading-inner">
      <button className="gsw-reader-back" onClick={onBack}>← Back to messages</button>
      <h2 className="gsw-reading-subject">{message.subject || "(no subject)"}</h2>
      <div className="gsw-reading-from"><SenderAvatar size="large" name={message.from?.name} email={message.from?.email} /><div><strong>{message.from?.name || message.from?.email || "Unknown sender"}</strong><span>{message.from?.email || ""}</span></div><time className="gsw-reading-time" dateTime={message.date}>{fmtDate(message.date)}</time></div>
      <p className="gsw-reading-recipient">To {recipientLabel}</p>
      <div className="gsw-toolbar" aria-label="Message actions">{folder === "Trash" ? <><button onClick={onRestore}>↶ <span>Restore</span></button><button className="gsw-danger-action" onClick={onDestroy}>🗑 <span>Delete forever</span></button></> : folder === "Sent" ? <><button onClick={onForward}>↪ <span>Forward</span></button><button onClick={onArchive}>▣ <span>Archive</span></button><button onClick={onTrash}>🗑 <span>Delete</span></button></> : folder === "Spam" ? <><button onClick={onRestore}>↶ <span>Not spam</span></button><button onClick={onTrash}>🗑 <span>Delete</span></button></> : <><button onClick={onReply}>↩ <span>Reply</span></button><button onClick={onReplyAll}>↩ <span>Reply all</span></button><button onClick={onForward}>↪ <span>Forward</span></button><button onClick={onArchive}>▣ <span>Archive</span></button><button onClick={onTrash}>🗑 <span>Delete</span></button><button onClick={onToggleRead}>◉ <span>{message.read ? "Mark unread" : "Mark read"}</span></button></>}<button aria-label="More message actions">⋯</button></div>
      <div className="gsw-reading-body">{body ? bodyBlocks(body).map((block, index) => block.kind === "quote" ? <blockquote className="gsw-quoted-block" key={`${block.kind}-${index}`}><span className="gsw-quoted-label">Quoted reply</span>{block.lines.join("\n")}</blockquote> : <div className="gsw-normal-block" key={`${block.kind}-${index}`}>{block.lines.join("\n")}</div>) : <span className="gsw-body-empty">This message has no readable body.</span>}</div>
      {!!message.attachments?.length && <div className="gsw-attachments"><h3>Attachments</h3>{message.attachments.map((attachment) => <div className="gsw-attachment" key={attachment.engineId}><span className="gsw-att-icon" aria-hidden="true">▤</span><div><strong>{attachment.filename}</strong><span>{formatBytes(attachment.size)} · {attachment.contentType}</span></div><span className="gsw-attachment-action">Download</span></div>)}</div>}
      <div className="gsw-reader-bottom-actions"><button className="gsw-secondary-btn" onClick={onReply}>↩ Reply</button><button className="gsw-secondary-btn" onClick={onForward}>↪ Forward</button></div>
    </article>
  );
}

const formatBytes = (size: number) => size < 1024 ? `${size} B` : size < 1024 * 1024 ? `${Math.round(size / 1024)} KB` : `${(size / (1024 * 1024)).toFixed(1)} MB`;
