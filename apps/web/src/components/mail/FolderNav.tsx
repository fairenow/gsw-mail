import { FOLDERS, FOLDER_ICON, type Folder } from "../folders";

export function FolderNav({ folder, unreadCount, collapsed, onSelect }: { folder: Folder; unreadCount: number; collapsed: boolean; onSelect: (folder: Folder) => void }) {
  return (
    <nav className="gsw-folder-nav" aria-label="Folders">
      {FOLDERS.map((name) => (
        <button key={name} className={`gsw-folder ${folder === name ? "active" : ""}`} onClick={() => onSelect(name)} title={collapsed ? name : undefined}>
          <span className="gsw-folder-icon" aria-hidden="true">{FOLDER_ICON[name]}</span><span>{name}</span>
          {name === "Inbox" && unreadCount > 0 && <span className="gsw-badge">{unreadCount}</span>}
        </button>
      ))}
    </nav>
  );
}
