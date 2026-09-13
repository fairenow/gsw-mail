import { FOLDERS, FOLDER_ICON, type Folder } from "../folders";

export function FolderNav({ folder, counts, collapsed, onSelect }: { folder: Folder; counts: Record<Folder, { total: number; unread: number }>; collapsed: boolean; onSelect: (folder: Folder) => void }) {
  return (
    <nav className="gsw-folder-nav" aria-label="Folders">
      {FOLDERS.map((name) => (
        <button key={name} className={`gsw-folder ${folder === name ? "active" : ""}`} onClick={() => onSelect(name)} title={collapsed ? name : undefined}>
          <span className="gsw-folder-icon" aria-hidden="true">{FOLDER_ICON[name]}</span><span>{name}</span>
          {counts[name].total > 0 && <span className="gsw-badge">{counts[name].total}</span>}
        </button>
      ))}
    </nav>
  );
}
