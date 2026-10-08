import { useRef, useState, type FormEvent } from "react";
import { AlertCircle, CheckCircle2, ChevronLeft, ChevronRight, LoaderCircle, Menu, Search, X } from "lucide-react";
import type { Account, AiTaskRecord } from "../api";
import { AccountMenu } from "./mail/AccountMenu";

export type AppTopBarOptions = {
  search: string;
  searchPlaceholder: string;
  onSearchChange: (value: string) => void;
  onSearch: () => void;
  searchDisabled?: boolean;
  sidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
  onSelectAccount?: (id: string) => void;
};

export function AppTopBar({ account, accounts, profileImageUrl, agentTask, search, searchPlaceholder, onSearchChange, onSearch, searchDisabled, sidebarCollapsed, onToggleSidebar, onSelectAccount }: AppTopBarOptions & {
  account: Account | null;
  accounts: Account[];
  profileImageUrl?: string;
  agentTask?: AiTaskRecord | null;
}) {
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);
  const searchToggle = useRef<HTMLButtonElement>(null);
  const closeSearch = () => { setSearchOpen(false); searchToggle.current?.focus(); };
  const submit = (event: FormEvent) => { event.preventDefault(); if (!searchDisabled) onSearch(); };
  const isMailRoute = window.location.pathname === "/mail";

  return (
    <header className="gsw-topnav">
      <div className="gsw-topnav-brand">
        {agentTask ? (
          <button
            type="button"
            className={`gsw-agent-task-pill status-${agentTask.status}`}
            onClick={() => window.dispatchEvent(new CustomEvent("gsw-workspace-open", { detail: { section: "chat" } }))}
            title="Open GSW Chat"
          >
            <span className="gsw-agent-task-icon" aria-hidden="true">
              {agentTask.status === "completed" ? <CheckCircle2 size={17} /> : agentTask.status === "failed" ? <AlertCircle size={17} /> : <LoaderCircle size={17} className={agentTask.status === "running" ? "spin" : ""} />}
            </span>
            <span className="gsw-agent-task-copy">
              <strong>{agentTask.status === "waiting" ? "Waiting for you" : agentTask.status === "completed" ? "Task complete" : agentTask.status === "failed" ? "Task needs attention" : "GSW is working"}</strong>
              <small>{agentTask.title}{agentTask.progressPercent > 0 && agentTask.status !== "completed" ? ` · ${agentTask.progressPercent}%` : ""}</small>
            </span>
          </button>
        ) : isMailRoute && onToggleSidebar ? (
          <>
            <button className="gsw-logo-toggle" onClick={onToggleSidebar} aria-label="Toggle mail navigation" title={sidebarCollapsed ? "Expand navigation" : "Collapse navigation"}>
              <img className="gsw-wordmark-mark" src="/logo.png" alt="" aria-hidden="true" />
              <span className="gsw-mobile-menu-icon" aria-hidden="true"><Menu size={20} /></span>
              <span className="gsw-logo-toggle-icon" aria-hidden="true">{sidebarCollapsed ? <ChevronRight size={20} strokeWidth={1.75} /> : <ChevronLeft size={20} strokeWidth={1.75} />}</span>
            </button>
            <span className="gsw-wordmark">GSW Mail</span>
          </>
        ) : (
          <a className="gsw-topnav-brand-link" href="/mail" aria-label="Open GSW Mail">
            <img className="gsw-wordmark-mark" src="/logo.png" alt="" aria-hidden="true" />
            <span className="gsw-wordmark">GSW Mail</span>
          </a>
        )}
      </div>
      <button ref={searchToggle} className="gsw-icon-btn gsw-search-toggle" aria-label="Open search" aria-expanded={searchOpen} disabled={searchDisabled} onClick={() => { setSearchOpen(true); requestAnimationFrame(() => searchInput.current?.focus()); }}><Search size={20} /></button>
      <form className={`gsw-topnav-search ${searchOpen ? "search-open" : ""}`} onSubmit={submit} role="search">
        <span className="gsw-search-icon" aria-hidden="true"><Search size={18} strokeWidth={1.75} /></span>
        <input ref={searchInput} onKeyDown={(event) => { if (event.key === "Escape") closeSearch(); }} value={search} onChange={(event) => onSearchChange(event.target.value)} placeholder={searchPlaceholder} aria-label={searchPlaceholder} disabled={searchDisabled} />
        <button type="button" className="gsw-icon-btn gsw-search-close" aria-label="Close search" onClick={closeSearch}><X size={20} /></button>
      </form>
      <div className="gsw-topnav-end"><AccountMenu account={account} accounts={accounts} profileImageUrl={profileImageUrl} onSelect={onSelectAccount ?? (() => undefined)} /></div>
    </header>
  );
}
