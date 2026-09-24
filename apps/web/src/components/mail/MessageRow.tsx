import { api, type MessageSummary } from "../../api";
import { Archive, Ellipsis, Mail, MailOpen, RotateCcw, Star, Trash2 } from "lucide-react";
import type { Folder } from "../folders";
import { SenderAvatar } from "./SenderAvatar";

const rowDate = (value: string) => new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });

export function MessageRow({ message, active, selected, folder, onOpen, onPrefetch, onSelect, onToggleRead, onToggleFlag, onDelete, onArchive, onRestore, onDestroy }: {
  message: MessageSummary;
  active: boolean;
  selected: boolean;
  folder: Folder;
  onOpen: () => void;
  onPrefetch?: () => void;
  onSelect: () => void;
  onToggleRead: () => void;
  onToggleFlag: () => void;
  onDelete: () => void;
  onArchive: () => void;
  onRestore?: () => void;
  onDestroy?: () => void;
}) {
  const sender = message.from?.name || message.from?.email || "Unknown sender";
  const prefetch = () => { api.prefetchActiveMessage(message.engineId); onPrefetch?.(); };
  return (
    <article className={`gsw-message-row ${message.read ? "read" : "unread"} ${active ? "open" : ""} ${selected ? "selected" : ""}`} onClick={onOpen} onPointerEnter={prefetch} onFocus={prefetch} tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onOpen(); }}>
      <input type="checkbox" checked={selected} onChange={onSelect} onClick={(event) => event.stopPropagation()} aria-label={`Select ${message.subject || "message"}`} style={{ flex: "0 0 auto", width: 16, height: 16, accentColor: "#e89a12", cursor: "pointer" }} />
      <SenderAvatar name={message.from?.name} email={message.from?.email} />
      <div className="gsw-message-row-content">
        <div className="gsw-message-row-head"><strong>{sender}</strong><time dateTime={message.date}>{rowDate(message.date)}</time></div>
        <div className="gsw-message-row-meta">{message.subject || "(no subject)"}</div>
        <div className="gsw-message-row-preview">{message.snippet || "No preview available"}</div>
      </div>
      <button type="button" onClick={(event) => { event.stopPropagation(); onToggleFlag(); }} aria-label={message.flagged ? "Unstar message" : "Star message"} title={message.flagged ? "Unstar" : "Star"} style={{ border: 0, background: "transparent", padding: 2, cursor: "pointer", color: message.flagged ? "#e89a12" : "#9b978e", flex: "0 0 auto", alignSelf: "flex-start", marginLeft: "auto" }}><Star size={17} fill={message.flagged ? "currentColor" : "none"} /></button>
      <div className="gsw-row-actions">{folder === "Trash" ? <><button onClick={(event) => { event.stopPropagation(); onRestore?.(); }} aria-label="Restore message"><RotateCcw size={16} strokeWidth={1.75} aria-hidden="true" /></button><button onClick={(event) => { event.stopPropagation(); onDestroy?.(); }} aria-label="Delete forever" title="Delete forever"><Trash2 size={16} strokeWidth={1.75} aria-hidden="true" /></button></> : <><button onClick={(event) => { event.stopPropagation(); onToggleRead(); }} aria-label={message.read ? "Mark message unread" : "Mark message read"}>{message.read ? <Mail size={16} strokeWidth={1.75} aria-hidden="true" /> : <MailOpen size={16} strokeWidth={1.75} aria-hidden="true" />}</button><button onClick={(event) => { event.stopPropagation(); onArchive(); }} aria-label="Archive message"><Archive size={16} strokeWidth={1.75} aria-hidden="true" /></button><button onClick={(event) => { event.stopPropagation(); onDelete(); }} aria-label="Move message to Trash" title="Move to Trash"><Trash2 size={16} strokeWidth={1.75} aria-hidden="true" /></button></>}<button onClick={(event) => event.stopPropagation()} aria-label="More message actions"><Ellipsis size={16} strokeWidth={1.75} aria-hidden="true" /></button></div>
    </article>
  );
}
