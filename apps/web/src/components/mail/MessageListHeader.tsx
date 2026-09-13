import { RefreshCw } from "lucide-react";
import type { Folder } from "../folders";

export function MessageListHeader({ folder, count, onRefresh, onEmptyTrash }: { folder: Folder; count: number; onRefresh: () => void; onEmptyTrash?: () => void }) {
  return (
    <div className="gsw-message-list-head">
       <div className="gsw-list-title-row"><div><h2>{folder}</h2><p>{count} {count === 1 ? "message" : "messages"}</p></div><div className="gsw-list-head-actions">{onEmptyTrash && <button className="gsw-danger-btn gsw-empty-trash-btn" onClick={onEmptyTrash}>Empty Trash</button>}<button className="gsw-icon-btn" onClick={onRefresh} aria-label="Refresh messages"><RefreshCw size={18} strokeWidth={1.75} /></button></div></div>
    </div>
  );
}
