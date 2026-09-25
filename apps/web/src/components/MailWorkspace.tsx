import { useEffect, useState, type ReactNode } from "react";
import { api } from "../api";
import { FOLDERS, type Folder } from "./folders";
import { MailSidebar } from "./mail/MailSidebar";
import { useAppShell } from "./AppShell";

const emptyCounts = () => Object.fromEntries(FOLDERS.map((name) => [name, { total: 0, unread: 0 }])) as Record<Folder, { total: number; unread: number }>;
const countsCache = new Map<string, Record<Folder, { total: number; unread: number }>>();
const normalizeCounts = (stats: Record<string, { total: number; unread: number }>) => Object.fromEntries(FOLDERS.map((name) => [name, stats[name] ?? { total: 0, unread: 0 }])) as Record<Folder, { total: number; unread: number }>;
const goToMailbox = () => {
  if (window.location.pathname === "/") return;
  window.history.pushState({}, "", "/");
  window.dispatchEvent(new PopStateEvent("popstate"));
};

export function MailWorkspace({ section, children }: { section: "contacts" | "calendar" | "settings"; children: ReactNode }) {
  const { account, profileImageUrl, configureTopBar } = useAppShell();
  const [counts, setCounts] = useState<Record<Folder, { total: number; unread: number }>>(() => account ? countsCache.get(account.id) ?? emptyCounts() : emptyCounts());
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem("gsw-mail-sidebar-collapsed") === "true");
  const [foldersOpen, setFoldersOpen] = useState(false);

  useEffect(() => {
    if (!account) return;
    const cached = countsCache.get(account.id);
    if (cached) setCounts(cached);
    let cancelled = false;
    void api.mailboxStats(account.id).then((stats) => {
      if (cancelled) return;
      const next = normalizeCounts(stats);
      countsCache.set(account.id, next);
      setCounts(next);
    }).catch(() => undefined);
    return () => { cancelled = true; };
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
