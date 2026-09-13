import type { MessageSummary } from "../../api";
import { SenderAvatar } from "./SenderAvatar";

const rowDate = (value: string) => new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });

export function MessageRow({ message, active, onOpen, onToggleRead }: { message: MessageSummary; active: boolean; onOpen: () => void; onToggleRead: () => void }) {
  const sender = message.from?.name || message.from?.email || "Unknown sender";
  return (
    <article className={`gsw-message-row ${message.read ? "read" : "unread"} ${active ? "open" : ""}`} onClick={onOpen} tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onOpen(); }}>
      <SenderAvatar name={message.from?.name} email={message.from?.email} />
      <div className="gsw-message-row-content">
        <div className="gsw-message-row-head"><strong>{sender}</strong><time dateTime={message.date}>{rowDate(message.date)}</time></div>
        <div className="gsw-message-row-meta">{message.subject || "(no subject)"}</div>
        <div className="gsw-message-row-preview">{message.snippet || "No preview available"}</div>
      </div>
      <div className="gsw-row-actions"><button onClick={(event) => { event.stopPropagation(); onToggleRead(); }} aria-label={message.read ? "Mark message unread" : "Mark message read"}>{message.read ? "○" : "●"}</button><button onClick={(event) => event.stopPropagation()} aria-label="Star message">☆</button><button onClick={(event) => event.stopPropagation()} aria-label="More message actions">⋯</button></div>
    </article>
  );
}
