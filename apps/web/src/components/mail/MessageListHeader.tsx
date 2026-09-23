import { Archive, Mail, MailOpen, RefreshCw, RotateCcw, Star, Trash2, X } from "lucide-react";
import type { BulkMailAction } from "../../api";
import type { Folder } from "../folders";

export function MessageListHeader({ folder, count, selectedCount, allSelected, onToggleSelectAll, onClearSelection, onBulkAction, onRefresh, onEmptyTrash }: {
  folder: Folder;
  count: number;
  selectedCount: number;
  allSelected: boolean;
  onToggleSelectAll: () => void;
  onClearSelection: () => void;
  onBulkAction: (action: BulkMailAction) => void;
  onRefresh: () => void;
  onEmptyTrash?: () => void;
}) {
  return (
    <div className="gsw-message-list-head">
      <div className="gsw-list-title-row">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <input type="checkbox" checked={allSelected && count > 0} onChange={onToggleSelectAll} aria-label={allSelected ? "Deselect all shown messages" : "Select all shown messages"} style={{ width: 16, height: 16, accentColor: "#e89a12", cursor: "pointer" }} />
          <div><h2>{folder}</h2><p>{selectedCount ? `${selectedCount} selected` : `${count} ${count === 1 ? "message" : "messages"}`}</p></div>
        </div>
        <div className="gsw-list-head-actions">
          {selectedCount > 0 ? <>
            {folder === "Trash" ? <><button className="gsw-icon-btn" onClick={() => onBulkAction("restore")} aria-label="Restore selected" title="Restore"><RotateCcw size={17} /></button><button className="gsw-icon-btn" onClick={() => onBulkAction("destroy")} aria-label="Delete selected forever" title="Delete forever"><Trash2 size={17} /></button></> : <><button className="gsw-icon-btn" onClick={() => onBulkAction("archive")} aria-label="Archive selected" title="Archive"><Archive size={17} /></button><button className="gsw-icon-btn" onClick={() => onBulkAction("trash")} aria-label="Move selected to trash" title="Delete"><Trash2 size={17} /></button></>}
            <button className="gsw-icon-btn" onClick={() => onBulkAction("star")} aria-label="Star selected" title="Star"><Star size={17} /></button>
            <button className="gsw-icon-btn" onClick={() => onBulkAction("read")} aria-label="Mark selected read" title="Mark read"><MailOpen size={17} /></button>
            <button className="gsw-icon-btn" onClick={() => onBulkAction("unread")} aria-label="Mark selected unread" title="Mark unread"><Mail size={17} /></button>
            <button className="gsw-icon-btn" onClick={onClearSelection} aria-label="Clear selection" title="Deselect all"><X size={17} /></button>
          </> : <>{onEmptyTrash && <button className="gsw-danger-btn gsw-empty-trash-btn" onClick={onEmptyTrash}>Empty Trash</button>}<button className="gsw-icon-btn" onClick={onRefresh} aria-label="Refresh messages"><RefreshCw size={18} strokeWidth={1.75} /></button></>}
        </div>
      </div>
    </div>
  );
}
