import type { Account } from "../../api";
import type { Folder } from "../folders";
import { FolderNav } from "./FolderNav";
import { SenderAvatar } from "./SenderAvatar";

export function MailSidebar({ account, folder, unreadCount, composeOpen, mobileHidden, onSelectFolder, onToggleCompose }: {
  account: Account | null;
  folder: Folder;
  unreadCount: number;
  composeOpen: boolean;
  mobileHidden: boolean;
  onSelectFolder: (folder: Folder) => void;
  onToggleCompose: () => void;
}) {
  return (
    <aside className={`gsw-sidebar ${mobileHidden ? "mobile-hidden" : ""}`}>
      <div className="gsw-sidebar-identity"><SenderAvatar name={account?.displayName ?? undefined} email={account?.address} /><div><strong>{account?.displayName || "Your mailbox"}</strong><span>{account?.address}</span></div></div>
      <button className="gsw-compose-btn" onClick={onToggleCompose}><span aria-hidden="true">＋</span>{composeOpen ? "Close compose" : "Compose"}</button>
      <FolderNav folder={folder} unreadCount={unreadCount} onSelect={onSelectFolder} />
    </aside>
  );
}
