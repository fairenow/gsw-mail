import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, type Account } from "../api";
import { getSession } from "../auth";
import { rememberIdentity } from "../lib/rememberedIdentities";
import { AppTopBar, type AppTopBarOptions } from "./AppTopBar";

type AppShellContextValue = {
  account: Account | null;
  accounts: Account[];
  profileImageUrl: string;
  setProfileImageUrl: (url: string) => void;
  selectAccount: (id: string) => void;
  configureTopBar: (options: Partial<AppTopBarOptions>) => void;
};

type IdleWindow = Window & { requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number };

const AppShellContext = createContext<AppShellContextValue | null>(null);

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
  void Promise.allSettled([
    api.messages(accountId, "Inbox", 50, 0),
    api.mailboxStats(accountId),
  ]);

  const range = currentCalendarRange();
  api.prefetchCalendarEvents(accountId, range.after, range.before);
  void api.calendars(accountId).catch(() => undefined);

  const warmContacts = () => {
    api.prefetchContactsPage();
    void Promise.allSettled([api.contactImports(), api.contactAddressBooks()]);
  };
  const idleCallback = (window as IdleWindow).requestIdleCallback;
  if (idleCallback) idleCallback(warmContacts, { timeout: 500 });
  else window.setTimeout(warmContacts, 250);
};

export function AppShell({ children }: { children: ReactNode }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [account, setAccount] = useState<Account | null>(null);
  const [profileImageUrl, setProfileImageUrl] = useState("");
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
        if (next) warmAccountData(next.id);
        return next;
      });
    }).catch(() => undefined);
    void Promise.all([api.settings(), getSession()]).then(([settings, session]) => {
      if (cancelled) return;
      const nextProfileImageUrl = typeof settings.general.profileImageUrl === "string" ? settings.general.profileImageUrl : "";
      setProfileImageUrl(nextProfileImageUrl);
      if (session) {
        rememberIdentity({
          id: session.user.id,
          email: session.user.email,
          name: session.user.name || session.user.email,
          image: nextProfileImageUrl || session.user.image,
        });
      }
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  const selectAccount = (id: string) => {
    const next = accounts.find((item) => item.id === id) ?? null;
    setAccount(next);
    if (next) warmAccountData(next.id);
  };

  const value = useMemo<AppShellContextValue>(() => ({
    account,
    accounts,
    profileImageUrl,
    setProfileImageUrl: (url) => {
      setProfileImageUrl(url);
      void getSession().then((session) => {
        if (!session) return;
        rememberIdentity({
          id: session.user.id,
          email: session.user.email,
          name: session.user.name || session.user.email,
          image: url || session.user.image,
        });
      }).catch(() => undefined);
    },
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
