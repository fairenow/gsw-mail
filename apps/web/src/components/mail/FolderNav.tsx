import { FOLDERS, FOLDER_ICON, type Folder } from "../folders";
import { CalendarDays, ContactRound } from "lucide-react";

export function FolderNav({ folder, counts, collapsed, onSelect }: { folder: Folder; counts: Record<Folder, { total: number; unread: number }>; collapsed: boolean; onSelect: (folder: Folder) => void }) {
  return (
    <nav className="gsw-folder-nav" aria-label="Folders">
      {FOLDERS.map((name) => {
        const Icon = FOLDER_ICON[name];
        return <button key={name} className={`gsw-folder ${folder === name ? "active" : ""}`} onClick={() => onSelect(name)} title={collapsed ? name : undefined}>
          <span className="gsw-folder-icon" aria-hidden="true"><Icon size={18} strokeWidth={1.75} /></span><span>{name}</span>
          {counts[name].total > 0 && <span className="gsw-badge">{counts[name].total}</span>}
        </button>;
      })}
      <div className="gsw-folder-nav-divider" />
      <a className="gsw-folder gsw-folder-link" href="/contacts" title={collapsed ? "Contacts" : undefined}><span className="gsw-folder-icon" aria-hidden="true"><ContactRound size={18} strokeWidth={1.75} /></span><span>Contacts</span></a>
      <a className="gsw-folder gsw-folder-link" href="/calendar" title={collapsed ? "Calendar" : undefined}><span className="gsw-folder-icon" aria-hidden="true"><CalendarDays size={18} strokeWidth={1.75} /></span><span>Calendar</span></a>
    </nav>
  );
}
