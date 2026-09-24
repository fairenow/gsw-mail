import { useEffect, useState, type ReactNode } from "react";
import { api } from "../api";
import { FOLDERS, type Folder } from "./folders";
import { MailSidebar } from "./mail/MailSidebar";
import { useAppShell } from "./AppShell";

const emptyCounts = () => Object.fromEntries(FOLDERS.map((name) => [name, { total: 0, unread: 0 }])) as Record<Folder, { total: number; unread: number }>;
const goToMailbox = () => {
  if (window.location.pathname === "/") return;
  window.history.pushState({}, "", "/");
  window.dispatchEvent(new PopStateEvent("popstate"));
};

export function MailWorkspace({ section, children }: { section: "contacts" | "calendar" | "settings"; children: ReactNode }) {
  const { account, profileImageUrl, configureTopBar } = useAppShell();
  const [counts, setCounts] = useState(emptyCounts);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem("gsw-mail-sidebar-collapsed") === "true");
  const [foldersOpen, setFoldersOpen] = useState(false);

  useEffect(() => {
    if (!account) return;
    void api.mailboxStats(account.id).then((stats) => setCounts(Object.fromEntries(FOLDERS.map((name) => [name, stats[name] ?? { total: 0, unread: 0 }])) as Record<Folder, { total: number; unread: number }>)).catch(() => undefined);
  }, [account]);
  useEffect(() => {
    const toggle = () => {
      if (window.matchMedia("(max-width: 1099px)").matches) setFoldersOpen((current) => !current);
      else setSidebarCollapsed((current) => { const next = !current; localStorage.setItem("gsw-mail-sidebar-collapsed", String(next)); return next; });
    };
    configureTopBar({ sidebarCollapsed, onToggleSidebar: toggle });
  }, [configureTopBar, sidebarCollapsed]);

  return <main className={`gsw-mail-body gsw-workspace-body ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
    {foldersOpen && <button className="gsw-folder-backdrop" aria-label="Close folders" onClick={() => setFoldersOpen(false)} />}
    <MailSidebar account={account} profileImageUrl={profileImageUrl} folder="Inbox" counts={counts} composeOpen={false} mobileHidden={!foldersOpen} collapsed={sidebarCollapsed} section={section} onSelectFolder={goToMailbox} onToggleCompose={goToMailbox} />
    <section className="gsw-workspace-panel">{children}</section>
  </main>;
}
