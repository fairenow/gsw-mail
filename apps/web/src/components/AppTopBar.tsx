import type { FormEvent } from "react";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import type { Account } from "../api";
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

export function AppTopBar({ account, accounts, profileImageUrl, search, searchPlaceholder, onSearchChange, onSearch, searchDisabled, sidebarCollapsed, onToggleSidebar, onSelectAccount }: AppTopBarOptions & {
  account: Account | null;
  accounts: Account[];
  profileImageUrl?: string;
}) {
  const submit = (event: FormEvent) => { event.preventDefault(); if (!searchDisabled) onSearch(); };

  return (
    <header className="gsw-topnav">
      <div className="gsw-topnav-brand">
        {onToggleSidebar ? (
          <>
            <button className="gsw-logo-toggle" onClick={onToggleSidebar} aria-label={sidebarCollapsed ? "Expand navigation" : "Collapse navigation"} title={sidebarCollapsed ? "Expand navigation" : "Collapse navigation"}>
              <img className="gsw-wordmark-mark" src="/logo.png" alt="" aria-hidden="true" />
              <span className="gsw-logo-toggle-icon" aria-hidden="true">{sidebarCollapsed ? <ChevronRight size={20} strokeWidth={1.75} /> : <ChevronLeft size={20} strokeWidth={1.75} />}</span>
            </button>
            <a className="gsw-wordmark" href="/">GSW Mail</a>
          </>
        ) : (
          <a className="gsw-topnav-brand-link" href="/">
            <img className="gsw-wordmark-mark" src="/logo.png" alt="" aria-hidden="true" />
            <span className="gsw-wordmark">GSW Mail</span>
          </a>
        )}
      </div>
      <form className="gsw-topnav-search" onSubmit={submit} role="search">
        <span className="gsw-search-icon" aria-hidden="true"><Search size={18} strokeWidth={1.75} /></span>
        <input value={search} onChange={(event) => onSearchChange(event.target.value)} placeholder={searchPlaceholder} aria-label={searchPlaceholder} disabled={searchDisabled} />
      </form>
      <div className="gsw-topnav-end"><AccountMenu account={account} accounts={accounts} profileImageUrl={profileImageUrl} onSelect={onSelectAccount ?? (() => undefined)} /></div>
    </header>
  );
}
