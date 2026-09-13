import type { FormEvent } from "react";
import type { Account } from "../../api";
import { AccountMenu } from "./AccountMenu";

export function MailTopBar({ account, accounts, profileImageUrl, search, onSearchChange, onSearch, onSelectAccount, sidebarCollapsed, onToggleSidebar }: {
  account: Account | null;
  accounts: Account[];
  profileImageUrl?: string;
  search: string;
  onSearchChange: (value: string) => void;
  onSearch: () => void;
  onSelectAccount: (id: string) => void;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
}) {
  const submit = (event: FormEvent) => { event.preventDefault(); onSearch(); };

  return (
    <header className="gsw-topnav">
      <div className="gsw-topnav-brand">
        <button className="gsw-logo-toggle" onClick={onToggleSidebar} aria-label={sidebarCollapsed ? "Expand navigation" : "Collapse navigation"} title={sidebarCollapsed ? "Expand navigation" : "Collapse navigation"}>
          <img className="gsw-wordmark-mark" src="/logo.png" alt="" aria-hidden="true" />
          <span className="gsw-logo-toggle-icon" aria-hidden="true">{sidebarCollapsed ? "›" : "‹"}</span>
        </button>
        <a className="gsw-wordmark" href="/">GSW Mail</a>
      </div>
      <form className="gsw-topnav-search" onSubmit={submit} role="search">
        <span className="gsw-search-icon" aria-hidden="true">⌕</span>
        <input value={search} onChange={(event) => onSearchChange(event.target.value)} placeholder="Search mail" aria-label="Search mail" />
      </form>
      <div className="gsw-topnav-end"><AccountMenu account={account} accounts={accounts} profileImageUrl={profileImageUrl} onSelect={onSelectAccount} /></div>
    </header>
  );
}
