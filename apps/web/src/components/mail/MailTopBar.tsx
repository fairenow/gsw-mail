import type { FormEvent } from "react";
import type { Account } from "../../api";
import { AccountMenu } from "./AccountMenu";

export function MailTopBar({ account, accounts, search, onSearchChange, onSearch, onSelectAccount }: {
  account: Account | null;
  accounts: Account[];
  search: string;
  onSearchChange: (value: string) => void;
  onSearch: () => void;
  onSelectAccount: (id: string) => void;
}) {
  const submit = (event: FormEvent) => { event.preventDefault(); onSearch(); };

  return (
    <header className="gsw-topnav">
      <a className="gsw-topnav-brand" href="/">
        <img className="gsw-wordmark-mark" src="/logo-3.png" alt="" aria-hidden="true" />
        <span className="gsw-wordmark">GSW Mail</span>
      </a>
      <form className="gsw-topnav-search" onSubmit={submit} role="search">
        <span className="gsw-search-icon" aria-hidden="true">⌕</span>
        <input value={search} onChange={(event) => onSearchChange(event.target.value)} placeholder="Search mail" aria-label="Search mail" />
      </form>
      <div className="gsw-topnav-end"><AccountMenu account={account} accounts={accounts} onSelect={onSelectAccount} /></div>
    </header>
  );
}
