import type { ReactNode } from "react";
import { FOLDERS, FOLDER_ICON, type Folder } from "../folders";
import type { MailFolder } from "../../api";
import { CalendarDays, ContactRound, Folder as FolderIcon, FolderPlus, Plus } from "lucide-react";

const childrenOf = (folders: MailFolder[], parentId: string | null) => folders
  .filter((item) => !item.system && item.parentId === parentId)
  .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));

export function FolderNav({ folder, counts, customFolders = [], collapsed, section = "mail", onSelect, onPrefetch, onCreateFolder }: {
  folder: Folder;
  counts: Record<Folder, { total: number; unread: number }>;
  customFolders?: MailFolder[];
  collapsed: boolean;
  section?: "mail" | "contacts" | "calendar" | "settings";
  onSelect: (folder: Folder) => void;
  onPrefetch?: (folder: Folder) => void;
  onCreateFolder?: (parentId: string | null) => void;
}) {
  const renderCustom = (parentId: string | null, depth = 0): ReactNode => childrenOf(customFolders, parentId).map((item) => {
    const customName = item.name as Folder;
    return <div key={item.id}>
      <div style={{ display: "flex", alignItems: "center", paddingLeft: collapsed ? 0 : depth * 16 }}>
        <button
          className={`gsw-folder ${folder === customName ? "active" : ""}`}
          style={{ flex: 1, minWidth: 0 }}
          onPointerEnter={() => onPrefetch?.(customName)}
          onFocus={() => onPrefetch?.(customName)}
          onClick={() => onSelect(customName)}
          title={collapsed ? item.name : undefined}
        >
          <span className="gsw-folder-icon" aria-hidden="true"><FolderIcon size={18} strokeWidth={1.75} /></span>
          <span>{item.name}</span>
          {item.total > 0 && <span className="gsw-badge">{item.total}</span>}
        </button>
        {!collapsed && onCreateFolder && <button className="gsw-icon-btn" style={{ width: 28, height: 28, flex: "0 0 auto" }} onClick={() => onCreateFolder(item.id)} aria-label={`Add subfolder to ${item.name}`} title="Add subfolder"><Plus size={14} /></button>}
      </div>
      {renderCustom(item.id, depth + 1)}
    </div>;
  });

  return (
    <nav className="gsw-folder-nav" aria-label="Folders">
      {FOLDERS.map((name: Folder) => {
        const Icon = FOLDER_ICON[name];
        return <button key={name} className={`gsw-folder ${folder === name ? "active" : ""}`} onPointerEnter={() => onPrefetch?.(name)} onFocus={() => onPrefetch?.(name)} onClick={() => onSelect(name)} title={collapsed ? name : undefined}>
          <span className="gsw-folder-icon" aria-hidden="true"><Icon size={18} strokeWidth={1.75} /></span><span>{name}</span>
          {(counts[name]?.total ?? 0) > 0 && <span className="gsw-badge">{counts[name]!.total}</span>}
        </button>;
      })}
      <div className="gsw-folder-nav-divider" />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: collapsed ? "0" : "2px 10px 6px 12px" }}>
        {!collapsed && <span style={{ fontSize: 12, fontWeight: 600, opacity: 0.62 }}>Folders</span>}
        {onCreateFolder && <button className="gsw-icon-btn" onClick={() => onCreateFolder(null)} aria-label="Create folder" title="Create folder"><FolderPlus size={16} /></button>}
      </div>
      {renderCustom(null)}
      <div className="gsw-folder-nav-divider" />
      <a className={`gsw-folder gsw-folder-link ${section === "contacts" ? "active" : ""}`} href="/contacts" title={collapsed ? "Contacts" : undefined}><span className="gsw-folder-icon" aria-hidden="true"><ContactRound size={18} strokeWidth={1.75} /></span><span>Contacts</span></a>
      <a className={`gsw-folder gsw-folder-link ${section === "calendar" ? "active" : ""}`} href="/calendar" title={collapsed ? "Calendar" : undefined}><span className="gsw-folder-icon" aria-hidden="true"><CalendarDays size={18} strokeWidth={1.75} /></span><span>Calendar</span></a>
    </nav>
  );
}
