import { useState } from "react";
import { logout } from "../../auth";
import type { Account } from "../../api";
import { SenderAvatar } from "./SenderAvatar";

export function AccountMenu({ account, accounts, onSelect }: { account: Account | null; accounts: Account[]; onSelect: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  if (!account) return null;

  return (
    <div className="gsw-avatar-wrap">
      <button className="gsw-account-trigger" onClick={() => setOpen((value) => !value)} aria-label="Open account menu" aria-expanded={open}>
        <SenderAvatar name={account.displayName ?? undefined} email={account.address} />
        <span className="gsw-account-trigger-copy"><strong>{account.displayName || account.address}</strong><span>{account.address}</span></span>
        <span className="gsw-account-chevron" aria-hidden="true">⌄</span>
      </button>
      {open && (
        <div className="gsw-account-menu">
          <div className="gsw-account-summary">
            <SenderAvatar name={account.displayName ?? undefined} email={account.address} />
            <div><strong>{account.displayName || "GSW Mail account"}</strong><span>{account.address}</span></div>
          </div>
          <div className="gsw-account-menu-rule" />
          <a className="gsw-menu-action" href="/contacts" onClick={() => setOpen(false)}>Contacts</a>
          <a className="gsw-menu-action" href="/settings" onClick={() => setOpen(false)}>Settings</a>
          {accounts.length > 1 && <div className="gsw-account-menu-rule" />}
          {accounts.length > 1 && accounts.map((item) => (
            <button key={item.id} className={`gsw-account-menu-item ${item.id === account.id ? "current" : ""}`} onClick={() => { onSelect(item.id); setOpen(false); }}>
              <strong>{item.displayName || item.address}</strong><span>{item.address}</span>
            </button>
          ))}
          <div className="gsw-account-menu-rule" />
          <button className="gsw-menu-action" onClick={logout}>Sign out</button>
        </div>
      )}
    </div>
  );
}
