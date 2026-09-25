import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, type Account } from "../api";
import { AppTopBar, type AppTopBarOptions } from "./AppTopBar";

type AppShellContextValue = {
  account: Account | null;
  accounts: Account[];
  profileImageUrl: string;
  selectAccount: (id: string) => void;
  configureTopBar: (options: Partial<AppTopBarOptions>) => void;
};

type ShellSnapshot = { accounts: Account[]; selectedAccountId: string | null; profileImageUrl: string };
type IdleWindow = Window & { requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number };

const AppShellContext = createContext<AppShellContextValue | null>(null);
let shellSnapshot: ShellSnapshot = { accounts: [], selectedAccountId: null, profileImageUrl: "" };

const calendarBoundary = (date: Date) => {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
};

const currentCalendarRange = () => {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const after = new Date(first);
  after.setDate(after.getDate() - after.getDay());
  after.setHours(0, 0, 0, 0);
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const before = new Date(last);
  before.setDate(before.getDate() - before.getDay() + 7);
  before.setHours(0, 0, 0, 0);
  return { after: calendarBoundary(after), before: calendarBoundary(before) };
};

const warmAccountData = (accountId: string) => {
  // Mail is the primary workspace, so begin the Inbox and counts immediately.
  void Promise.allSettled([
    api.messages(accountId, "Inbox", 50, 0),
    api.mailboxStats(accountId),
  ]);

  // Calendar stays prefetched in parallel.
  const range = currentCalendarRange();
  api.prefetchCalendarEvents(accountId, range.after, range.before);
  void api.calendars(accountId).catch(() => undefined);

  // Warm contacts shortly after the critical mailbox request begins. This keeps
  // the Inbox prioritized while making Contacts ready before the user opens it.
  const warmContacts = () => {
    api.prefetchContactsPage();
    void Promise.allSettled([api.contactImports(), api.contactAddressBooks()]);
  };
  const idleCallback = (window as IdleWindow).requestIdleCallback;
  if (idleCallback) idleCallback(warmContacts, { timeout: 500 });
  else window.setTimeout(warmContacts, 250);
};

export function AppShell({ children }: { children: ReactNode }) {
  const [accounts, setAccounts] = useState<Account[]>(() => shellSnapshot.accounts);
  const [account, setAccount] = useState<Account | null>(() => shellSnapshot.accounts.find((item) => item.id === shellSnapshot.selectedAccountId) ?? shellSnapshot.accounts[0] ?? null);
  const [profileImageUrl, setProfileImageUrl] = useState(() => shellSnapshot.profileImageUrl);
  const [topBar, setTopBar] = useState<AppTopBarOptions>({
    search: "",
    searchPlaceholder: "Search mail",
    onSearchChange: () => undefined,
    onSearch: () => undefined,
    searchDisabled: true,
  });

  useEffect(() => {
    let cancelled = false;
    void api.accounts().then((rows) => {
      if (cancelled) return;
      setAccounts(rows);
      setAccount((current) => {
        const next = current && rows.some((item) => item.id === current.id) ? current : rows[0] ?? null;
        shellSnapshot = { ...shellSnapshot, accounts: rows, selectedAccountId: next?.id ?? null };
        if (next) warmAccountData(next.id);
        return next;
      });
    }).catch(() => undefined);
    void api.settings().then((settings) => {
      if (cancelled) return;
      const nextProfileImageUrl = typeof settings.general.profileImageUrl === "string" ? settings.general.profileImageUrl : "";
      setProfileImageUrl(nextProfileImageUrl);
      shellSnapshot = { ...shellSnapshot, profileImageUrl: nextProfileImageUrl };
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  const selectAccount = (id: string) => {
    const next = accounts.find((item) => item.id === id) ?? null;
    setAccount(next);
    shellSnapshot = { ...shellSnapshot, accounts, selectedAccountId: next?.id ?? null };
    if (next) warmAccountData(next.id);
  };

  const value = useMemo<AppShellContextValue>(() => ({
    account,
    accounts,
    profileImageUrl,
    selectAccount,
    configureTopBar: (options) => setTopBar((current) => ({ ...current, ...options })),
  }), [account, accounts, profileImageUrl]);

  return (
    <AppShellContext.Provider value={value}>
      <div className="gsw-app-shell">
        <AppTopBar account={account} accounts={accounts} profileImageUrl={profileImageUrl} {...topBar} onSelectAccount={topBar.onSelectAccount ?? value.selectAccount} />
        {children}
      </div>
    </AppShellContext.Provider>
  );
}

export function useAppShell(): AppShellContextValue {
  const context = useContext(AppShellContext);
  if (!context) throw new Error("useAppShell must be used inside AppShell");
  return context;
}
