import { useCallback, useEffect, useState } from "react";
import { api, type Account, type MailFolder } from "../../api";
import { SquarePen, X } from "lucide-react";
import type { Folder } from "../folders";
import { FolderNav } from "./FolderNav";
import { SenderAvatar } from "./SenderAvatar";

export function MailSidebar({ account, profileImageUrl, folder, counts, composeOpen, mobileHidden, collapsed, section, onSelectFolder, onToggleCompose, onOpenSection, onPrefetchSection }: {
  account: Account | null;
  profileImageUrl?: string;
  folder: Folder;
  counts: Record<Folder, { total: number; unread: number }>;
  composeOpen: boolean;
  mobileHidden: boolean;
  collapsed: boolean;
  section?: "mail" | "contacts" | "calendar" | "settings" | "files" | "chat";
  onSelectFolder: (folder: Folder) => void;
  onToggleCompose: () => void;
  onOpenSection?: (section: "contacts" | "calendar" | "settings" | "files" | "chat") => void;
  onPrefetchSection?: (section: "contacts" | "calendar" | "settings" | "files" | "chat") => void;
}) {
  const [customFolders, setCustomFolders] = useState<MailFolder[]>([]);
  const [folderError, setFolderError] = useState<string | null>(null);

  const loadCustomFolders = useCallback(async () => {
    if (!account) { setCustomFolders([]); return; }
    try {
      const folders = await api.folders(account.id);
      const custom = folders.filter((item) => !item.system);
      setCustomFolders(custom);
      for (const item of custom) {
        counts[item.name as Folder] = { total: item.total, unread: item.unread };
      }
      setFolderError(null);
    } catch (error) {
      setFolderError(error instanceof Error ? error.message : String(error));
    }
  }, [account, counts]);

  useEffect(() => { void loadCustomFolders(); }, [loadCustomFolders]);

  const createFolder = async (parentId: string | null) => {
    if (!account) return;
    const parent = parentId ? customFolders.find((item) => item.id === parentId) : undefined;
    const name = window.prompt(parent ? `New subfolder under ${parent.name}` : "New folder name");
    if (!name?.trim()) return;
    try {
      const created = await api.createFolder(account.id, name.trim(), parentId);
      await loadCustomFolders();
      counts[created.name as Folder] = { total: created.total, unread: created.unread };
      onSelectFolder(created.name as Folder);
    } catch (error) {
      setFolderError(error instanceof Error ? error.message : String(error));
    }
  };

  const prefetchFolder = (name: Folder) => {
    if (!account) return;
    void api.messages(account.id, name, 50, 0).catch(() => undefined);
  };

  return (
    <aside className={`gsw-sidebar ${mobileHidden ? "mobile-hidden" : ""} ${collapsed ? "collapsed" : ""}`}>
      <div className="gsw-sidebar-identity"><SenderAvatar name={account?.displayName ?? undefined} email={account?.address} imageUrl={profileImageUrl} /><div><strong>{account?.displayName || "Your mailbox"}</strong><span>{account?.address}</span></div></div>
       <button className="gsw-compose-btn" onClick={onToggleCompose} title={collapsed ? (composeOpen ? "Close compose" : "Compose") : undefined}><span aria-hidden="true">{composeOpen ? <X size={18} strokeWidth={2} /> : <SquarePen size={18} strokeWidth={2} />}</span><span className="gsw-sidebar-label">{composeOpen ? "Close compose" : "Compose"}</span></button>
       <FolderNav folder={folder} counts={counts} customFolders={customFolders} collapsed={collapsed} section={section} onSelect={onSelectFolder} onPrefetch={prefetchFolder} onCreateFolder={(parentId) => void createFolder(parentId)} onOpenSection={onOpenSection} onPrefetchSection={onPrefetchSection} />
       {!collapsed && folderError && <p className="gsw-errors" style={{ margin: "8px 12px" }}>{folderError}</p>}
    </aside>
  );
}
