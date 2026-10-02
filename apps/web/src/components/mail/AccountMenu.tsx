import { useEffect, useState } from "react";
import { Check, ChevronDown, KeyRound, LogOut, Mail, Plus, Settings, Users } from "lucide-react";
import { getSession, listDeviceSessions, logout, switchDeviceSession, type DeviceSession } from "../../auth";
import type { Account } from "../../api";
import { SenderAvatar } from "./SenderAvatar";

export function AccountMenu({ account, accounts, profileImageUrl, onSelect }: { account: Account | null; accounts: Account[]; profileImageUrl?: string; onSelect: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [deviceSessions, setDeviceSessions] = useState<DeviceSession[]>([]);
  const [currentAuthUserId, setCurrentAuthUserId] = useState<string | null>(null);
  const [switching, setSwitching] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([getSession(), listDeviceSessions()]).then(([session, sessions]) => {
      if (cancelled) return;
      setCurrentAuthUserId(session?.user.id ?? null);
      setDeviceSessions(sessions);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  if (!account) return null;

  const switchIdentity = async (session: DeviceSession) => {
    if (session.user.id === currentAuthUserId) { setOpen(false); return; }
    setSwitching(session.user.id);
    try { await switchDeviceSession(session.session.token); }
    catch { setSwitching(null); }
  };

  return (
    <div className="gsw-avatar-wrap">
      <button className="gsw-account-trigger" onClick={() => setOpen((value) => !value)} aria-label="Open account menu" aria-expanded={open}>
        <SenderAvatar name={account.displayName ?? undefined} email={account.address} imageUrl={profileImageUrl} />
        <span className="gsw-account-trigger-copy"><strong>{account.displayName || account.address}</strong><span>{account.address}</span></span>
        <span className="gsw-account-chevron" aria-hidden="true"><ChevronDown size={15} strokeWidth={1.75} /></span>
      </button>
      {open && (
        <div className="gsw-account-menu">
          <div className="gsw-account-summary">
            <SenderAvatar name={account.displayName ?? undefined} email={account.address} imageUrl={profileImageUrl} />
            <div><strong>{account.displayName || "GSW Mail account"}</strong><span>{account.address}</span></div>
          </div>

          <div className="gsw-account-menu-rule" />
          {deviceSessions.length > 0 && <div style={{ padding: "4px 14px 6px", fontSize: 11, fontWeight: 700, opacity: 0.58, letterSpacing: ".06em", textTransform: "uppercase" }}>GSW accounts</div>}
          {deviceSessions.map((session) => {
            const current = session.user.id === currentAuthUserId;
            return (
              <button key={session.session.token} className={`gsw-account-menu-item ${current ? "current" : ""}`} disabled={switching !== null} onClick={() => void switchIdentity(session)}>
                <SenderAvatar name={session.user.name} email={session.user.email} imageUrl={session.user.image ?? undefined} />
                <span style={{ minWidth: 0, flex: 1, textAlign: "left" }}><strong>{session.user.name || session.user.email}</strong><span>{session.user.email}</span></span>
                {current && <Check size={16} strokeWidth={2} aria-label="Current account" />}
              </button>
            );
          })}
          <a className="gsw-menu-action" href="/sign-in#use-another-account" onClick={() => setOpen(false)}><Plus size={16} strokeWidth={1.75} aria-hidden="true" />Add another account</a>

          <div className="gsw-account-menu-rule" />
          <a className="gsw-menu-action" href="/mail" onClick={() => setOpen(false)}><Mail size={16} strokeWidth={1.75} aria-hidden="true" />Mailbox</a>
          <a className="gsw-menu-action" href="/contacts" onClick={() => setOpen(false)}><Users size={16} strokeWidth={1.75} aria-hidden="true" />Contacts</a>
          <a className="gsw-menu-action" href="/settings" onClick={() => setOpen(false)}><Settings size={16} strokeWidth={1.75} aria-hidden="true" />Settings</a>
          <a className="gsw-menu-action" href="/oauth/test" onClick={() => setOpen(false)}><KeyRound size={16} strokeWidth={1.75} aria-hidden="true" />Connect with GSW</a>

          {accounts.length > 1 && <>
            <div className="gsw-account-menu-rule" />
            <div style={{ padding: "4px 14px 6px", fontSize: 11, fontWeight: 700, opacity: 0.58, letterSpacing: ".06em", textTransform: "uppercase" }}>Mailboxes in this account</div>
            {accounts.map((item) => (
              <button key={item.id} className={`gsw-account-menu-item ${item.id === account.id ? "current" : ""}`} onClick={() => { onSelect(item.id); setOpen(false); }}>
                <strong>{item.displayName || item.address}</strong><span>{item.address}</span>
              </button>
            ))}
          </>}

          <div className="gsw-account-menu-rule" />
          <button className="gsw-menu-action" onClick={() => void logout()}><LogOut size={16} strokeWidth={1.75} aria-hidden="true" />Sign out of this account</button>
        </div>
      )}
    </div>
  );
}
