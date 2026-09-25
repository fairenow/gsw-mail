import { api, type Account } from "../../api";
import { SquarePen, X } from "lucide-react";
import type { Folder } from "../folders";
import { FolderNav } from "./FolderNav";
import { SenderAvatar } from "./SenderAvatar";

export function MailSidebar({ account, profileImageUrl, folder, counts, composeOpen, mobileHidden, collapsed, section, onSelectFolder, onToggleCompose }: {
  account: Account | null;
  profileImageUrl?: string;
  folder: Folder;
  counts: Record<Folder, { total: number; unread: number }>;
  composeOpen: boolean;
  mobileHidden: boolean;
  collapsed: boolean;
  section?: "mail" | "contacts" | "calendar" | "settings";
  onSelectFolder: (folder: Folder) => void;
  onToggleCompose: () => void;
}) {
  const prefetchFolder = (name: Folder) => {
    if (!account) return;
    void api.messages(account.id, name, 50, 0).catch(() => undefined);
  };

  return (
    <aside className={`gsw-sidebar ${mobileHidden ? "mobile-hidden" : ""} ${collapsed ? "collapsed" : ""}`}>
      <div className="gsw-sidebar-identity"><SenderAvatar name={account?.displayName ?? undefined} email={account?.address} imageUrl={profileImageUrl} /><div><strong>{account?.displayName || "Your mailbox"}</strong><span>{account?.address}</span></div></div>
       <button className="gsw-compose-btn" onClick={onToggleCompose} title={collapsed ? (composeOpen ? "Close compose" : "Compose") : undefined}><span aria-hidden="true">{composeOpen ? <X size={18} strokeWidth={2} /> : <SquarePen size={18} strokeWidth={2} />}</span><span className="gsw-sidebar-label">{composeOpen ? "Close compose" : "Compose"}</span></button>
       <FolderNav folder={folder} counts={counts} collapsed={collapsed} section={section} onSelect={onSelectFolder} onPrefetch={prefetchFolder} />
    </aside>
  );
}
