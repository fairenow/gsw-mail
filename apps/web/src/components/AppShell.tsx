import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, type Account, type AiTaskRecord } from "../api";
import { getSession } from "../auth";
import { rememberIdentity } from "../lib/rememberedIdentities";
import { AppTopBar, type AppTopBarOptions } from "./AppTopBar";

type AppShellContextValue = {
  account: Account | null;
  accounts: Account[];
  profileImageUrl: string;
  activeAgentTask: AiTaskRecord | null;
  setProfileImageUrl: (url: string) => void;
  selectAccount: (id: string) => void;
  configureTopBar: (options: Partial<AppTopBarOptions>) => void;
};

const AppShellContext = createContext<AppShellContextValue | null>(null);

export function AppShell({ children }: { children: ReactNode }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [account, setAccount] = useState<Account | null>(null);
  const [profileImageUrl, setProfileImageUrl] = useState("");
  const [activeAgentTask, setActiveAgentTask] = useState<AiTaskRecord | null>(null);
  const [topBar, setTopBar] = useState<AppTopBarOptions>({
    search: "",
    searchPlaceholder: "Search mail",
    onSearchChange: () => undefined,
    onSearch: () => undefined,
    searchDisabled: true,
  });

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;

    const refresh = async () => {
      try {
        const response = await api.chatTasks(12);
        if (cancelled) return;
        const now = Date.now();
        const relevant = response.tasks.find((task) => {
          if (account?.id && task.accountId && task.accountId !== account.id) return false;
          if (task.status === "running" || task.status === "waiting" || task.status === "planned") return true;
          if ((task.status === "completed" || task.status === "failed") && task.completedAt) {
            return now - new Date(task.completedAt).getTime() < 12_000;
          }
          return false;
        }) ?? null;
        // Polls frequently, but don't publish new context values for an
        // unchanged task snapshot: that would rerender the entire workspace.
        setActiveAgentTask((current) => {
          if (current === relevant) return current;
          if (!current || !relevant) return relevant;
          return current.id === relevant.id &&
            current.status === relevant.status &&
            current.completedAt === relevant.completedAt ? current : relevant;
        });
      } catch {
        if (!cancelled) setActiveAgentTask(null);
      } finally {
        if (!cancelled) timer = window.setTimeout(refresh, activeAgentTask ? 3_000 : 7_000);
      }
    };

    void refresh();
    const handleTaskChange = () => { if (timer !== null) window.clearTimeout(timer); void refresh(); };
    window.addEventListener("gsw-agent-task-changed", handleTaskChange);
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
      window.removeEventListener("gsw-agent-task-changed", handleTaskChange);
    };
  }, [account?.id]);

  useEffect(() => {
    let cancelled = false;
    void api.accounts().then((rows) => {
      if (cancelled) return;
      setAccounts(rows);
      setAccount((current) => {
        const next = current && rows.some((item) => item.id === current.id) ? current : rows[0] ?? null;
        return next;
      });
    }).catch(() => undefined);
    // AuthGate has already validated the session; do not repeat that request
    // just to render the profile photo in the application shell.
    void api.settings().then((settings) => {
      if (cancelled) return;
      const image = settings.general.profileImageUrl;
      setProfileImageUrl(typeof image === "string" ? image : "");
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  const selectAccount = useCallback((id: string) => {
    const next = accounts.find((item) => item.id === id) ?? null;
    setAccount(next);
  }, [accounts]);

  const configureTopBar = useCallback((options: Partial<AppTopBarOptions>) => {
    setTopBar((current) => ({ ...current, ...options }));
  }, []);

  const value = useMemo<AppShellContextValue>(() => ({
    account,
    accounts,
    profileImageUrl,
    activeAgentTask,
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
    configureTopBar,
  }), [account, accounts, profileImageUrl, activeAgentTask, selectAccount, configureTopBar]);

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
