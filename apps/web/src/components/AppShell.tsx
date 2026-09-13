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

const AppShellContext = createContext<AppShellContextValue | null>(null);

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
    void api.accounts().then((rows) => { setAccounts(rows); setAccount((current) => current ?? rows[0] ?? null); }).catch(() => undefined);
    void api.settings().then((settings) => {
      setProfileImageUrl(typeof settings.general.profileImageUrl === "string" ? settings.general.profileImageUrl : "");
    }).catch(() => undefined);
  }, []);

  const value = useMemo<AppShellContextValue>(() => ({
    account,
    accounts,
    profileImageUrl,
    selectAccount: (id) => setAccount(accounts.find((item) => item.id === id) ?? null),
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
