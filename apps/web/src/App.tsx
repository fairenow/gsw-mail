import { useCallback, useEffect, useState } from "react";
import { api, type Account, type FullMessage, type MessageSummary } from "./api";

const FOLDERS = ["Inbox", "Sent", "Drafts", "Spam", "Trash", "Archive"] as const;
type Folder = (typeof FOLDERS)[number];

const fmt = (value: string) => new Date(value).toLocaleString();

export function App() {
  const [account, setAccount] = useState<Account | null>(null);
  const [folder, setFolder] = useState<Folder>("Inbox");
  const [messages, setMessages] = useState<MessageSummary[]>([]);
  const [open, setOpen] = useState<FullMessage | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  const loadFolder = useCallback(
    async (accountId: string, name: Folder) => {
      setError(null);
      try {
        setMessages(await api.messages(accountId, name));
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [],
  );

  useEffect(() => {
    api.accounts().then((accounts) => {
      const first = accounts[0];
      if (first) {
        setAccount(first);
        void loadFolder(first.id, "Inbox");
      }
    }).catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [loadFolder]);

  const selectFolder = (name: Folder) => {
    setFolder(name);
    setOpen(null);
    if (account) void loadFolder(account.id, name);
  };

  const selectMessage = async (message: MessageSummary) => {
    if (!account) return;
    const full = await api.message(account.id, message.engineId);
    setOpen(full);
    if (!message.read) {
      await api.read(account.id, message.engineId, true);
      setMessages((prev) => prev.map((m) => (m.engineId === message.engineId ? { ...m, read: true } : m)));
    }
  };

  const runAction = async (action: "archive" | "trash", engineId: string) => {
    if (!account) return;
    await (action === "archive" ? api.archive(account.id, engineId) : api.trash(account.id, engineId));
    setOpen(null);
    await loadFolder(account.id, folder);
  };

  const runSearch = async () => {
    if (!account || !query.trim()) return;
    setError(null);
    try {
      setMessages(await api.search(account.id, query));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div style={styles.shell}>
      <aside style={styles.sidebar}>
        <h1 style={styles.brand}>Guided Steps Mail</h1>
        <p style={styles.account}>{account?.address ?? "no account"}</p>
        <nav>
          {FOLDERS.map((name) => (
            <button key={name} onClick={() => selectFolder(name)} style={{ ...styles.folder, ...(folder === name ? styles.folderActive : {}) }}>
              {name}
            </button>
          ))}
        </nav>
        <div style={styles.search}>
          <input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void runSearch()} placeholder="Search" />
          <button onClick={() => void runSearch()}>Go</button>
        </div>
      </aside>

      <section style={styles.listPane}>
        {error && <p style={styles.error}>{error}</p>}
        {messages.map((m) => (
          <article key={m.engineId} onClick={() => void selectMessage(m)} style={{ ...styles.row, ...(m.read ? styles.rowRead : {}) }}>
            <strong>{m.from?.name ?? m.from?.email ?? "(unknown sender)"}</strong>
            <div>{m.subject || "(no subject)"}</div>
            <small>{m.snippet}</small>
            <time>{fmt(m.date)}</time>
          </article>
        ))}
      </section>

      <section style={styles.readPane}>
        {open ? (
          <>
            <h2>{open.subject}</h2>
            <p>
              From {open.from?.name ?? ""} &lt;{open.from?.email}&gt; · {fmt(open.date)}
            </p>
            <div style={styles.actions}>
              <button onClick={() => void runAction("archive", open.engineId)}>Archive</button>
              <button onClick={() => void runAction("trash", open.engineId)}>Delete</button>
            </div>
            <pre style={styles.body}>{open.textBody ?? open.htmlBody?.replace(/<[^>]+>/g, "") ?? ""}</pre>
          </>
        ) : (
          <p style={styles.placeholder}>Select a message</p>
        )}
      </section>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  shell: { display: "flex", minHeight: "100vh", fontFamily: "system-ui, sans-serif" },
  sidebar: { width: 260, borderRight: "1px solid #eee", padding: 16, flexShrink: 0 },
  brand: { fontSize: 18, margin: "0 0 4px" },
  account: { color: "#666", fontSize: 12, margin: "0 0 16px" },
  folder: { display: "block", width: "100%", textAlign: "left", padding: "8px 10px", border: 0, background: "transparent", cursor: "pointer", borderRadius: 6 },
  folderActive: { background: "#e8f0fe", fontWeight: 600 },
  search: { display: "flex", gap: 6, marginTop: 16 },
  listPane: { width: 360, borderRight: "1px solid #eee", overflow: "auto", flexShrink: 0 },
  row: { padding: "10px 14px", borderBottom: "1px solid #f2f2f2", cursor: "pointer" },
  rowRead: { opacity: 0.7 },
  error: { color: "#b00020", padding: 10 },
  readPane: { flex: 1, padding: 20, overflow: "auto" },
  actions: { display: "flex", gap: 8, margin: "12px 0" },
  body: { whiteSpace: "pre-wrap", fontFamily: "inherit", marginTop: 12 },
  placeholder: { color: "#888" },
};