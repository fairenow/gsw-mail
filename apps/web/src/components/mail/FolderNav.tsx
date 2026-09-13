import { FOLDERS, FOLDER_ICON, type Folder } from "../folders";

export function FolderNav({ folder, unreadCount, onSelect }: { folder: Folder; unreadCount: number; onSelect: (folder: Folder) => void }) {
  return (
    <nav className="gsw-folder-nav" aria-label="Folders">
      {FOLDERS.map((name) => (
        <button key={name} className={`gsw-folder ${folder === name ? "active" : ""}`} onClick={() => onSelect(name)}>
          <span className="gsw-folder-icon" aria-hidden="true">{FOLDER_ICON[name]}</span><span>{name}</span>
          {name === "Inbox" && unreadCount > 0 && <span className="gsw-badge">{unreadCount}</span>}
        </button>
      ))}
    </nav>
  );
}
