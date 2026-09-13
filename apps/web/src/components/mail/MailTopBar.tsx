import type { FormEvent } from "react";
import type { Account } from "../../api";
import { AccountMenu } from "./AccountMenu";

export function MailTopBar({ account, accounts, search, onSearchChange, onSearch, onSelectAccount, sidebarCollapsed, onToggleSidebar }: {
  account: Account | null;
  accounts: Account[];
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
      <button className="gsw-nav-toggle" onClick={onToggleSidebar} aria-label={sidebarCollapsed ? "Expand navigation" : "Collapse navigation"} title={sidebarCollapsed ? "Expand navigation" : "Collapse navigation"}>☰</button>
      <a className="gsw-topnav-brand" href="/">
        <img className="gsw-wordmark-mark" src="/logo-3.png" alt="" aria-hidden="true" />
        <span className="gsw-wordmark">GSW Mail</span>
      </a>
      <form className="gsw-topnav-search" onSubmit={submit} role="search">
        <span className="gsw-search-icon" aria-hidden="true">⌕</span>
        <input value={search} onChange={(event) => onSearchChange(event.target.value)} placeholder="Search mail" aria-label="Search mail" />
      </form>
      <div className="gsw-topnav-end"><a className="gsw-product-link" href="/contacts">Contacts</a><a className="gsw-product-link" href="/settings">Settings</a><AccountMenu account={account} accounts={accounts} onSelect={onSelectAccount} /></div>
    </header>
  );
}
