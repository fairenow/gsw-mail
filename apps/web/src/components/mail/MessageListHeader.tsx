import type { Folder } from "../folders";

export function MessageListHeader({ folder, count, onRefresh }: { folder: Folder; count: number; onRefresh: () => void }) {
  return (
    <div className="gsw-message-list-head">
      <div className="gsw-list-title-row"><div><h2>{folder}</h2><p>{count} {count === 1 ? "message" : "messages"}</p></div><button className="gsw-icon-btn" onClick={onRefresh} aria-label="Refresh messages">↻</button></div>
    </div>
  );
}
