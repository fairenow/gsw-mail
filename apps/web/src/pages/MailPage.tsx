import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  api,
  type Account,
  type FullMessage,
  type MessageSummary,
  type SendResult,
} from "../api";
import { type Folder } from "../components/folders";
import { MessageRow } from "../components/MessageRow";
import { Sidebar } from "../components/Sidebar";

const fmtTime = (value: string) => new Date(value).toLocaleString();

const sx: { [k: string]: React.CSSProperties } = {
  shell: { display: "flex", minHeight: "100vh", fontFamily: "system-ui, sans-serif" },
  listPane: { width: 400, borderRight: "1px solid #eee", overflow: "auto", flexShrink: 0 },
  compose: { padding: 12, borderBottom: "1px solid #eee", display: "flex", flexDirection: "column", gap: 8 },
  sendNote: { fontSize: 12, color: "#444" },
  error: { color: "#b00020", padding: 10 },
  readPane: { flex: 1, padding: 20, overflow: "auto" },
  actions: { display: "flex", gap: 8, margin: "12px 0" },
  body: { whiteSpace: "pre-wrap", fontFamily: "inherit", marginTop: 12 },
  placeholder: { color: "#888" },
};

export function MailPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [account, setAccount] = useState<Account | null>(null);
  const [folder, setFolder] = useState<Folder>("Inbox");
  const [messages, setMessages] = useState<MessageSummary[]>([]);
  const [open, setOpen] = useState<FullMessage | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [compose, setCompose] = useState(false);
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [text, setText] = useState("");
  const [lastSend, setLastSend] = useState<SendResult | null>(null);

  const loadFolder = useCallback(async (accountId: string, name: Folder) => {
    setError(null);
    try {
      setMessages(await api.messages(accountId, name));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    api
      .accounts()
      .then((rows) => {
        setAccounts(rows);
        if (rows[0]) {
          setAccount(rows[0]);
          void loadFolder(rows[0].id, "Inbox");
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [loadFolder]);

  const selectAccount = (id: string) => {
    const next = accounts.find((a) => a.id === id);
    if (!next) return;
    setAccount(next);
    setOpen(null);
    setLastSend(null);
    void loadFolder(next.id, folder);
  };

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

  const runSend = async () => {
    if (!account) return;
    setError(null);
    try {
      const recipients = to.split(",").map((r) => r.trim()).filter(Boolean);
      const result = await api.send(account.id, recipients, { subject, textBody: text, clientRequestId: crypto.randomUUID() });
      setLastSend(result);
      setCompose(false);
      setTo("");
      setSubject("");
      setText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const runUndo = async () => {
    if (!lastSend) return;
    try {
      const result = await api.cancelSend(lastSend.sendId);
      setLastSend({ ...lastSend, status: result.status });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!compose) return;
    void runSend();
  };

  return (
    <div style={sx.shell}>
      <Sidebar
        accountId={account?.id ?? ""}
        accounts={accounts}
        folder={folder}
        onSelectAccount={selectAccount}
        onSelectFolder={selectFolder}
        onToggleCompose={() => setCompose((v) => !v)}
        composeOpen={compose}
      />

      <section style={sx.listPane}>
        {error && <p style={sx.error}>{error}</p>}
        {compose && account ? (
          <form style={sx.compose} onSubmit={onSubmit}>
            <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="To (comma separated)" />
            <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" />
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} placeholder="Body" />
            <button type="submit">Send</button>
            {lastSend && (
              <p style={sx.sendNote}>
                sent <strong>{lastSend.sendId}</strong> · status {lastSend.status}
                {lastSend.undoUntil && (
                  <>
                    {" · "}undo before {fmtTime(lastSend.undoUntil)}{" "}
                    <button type="button" onClick={() => void runUndo()}>Cancel</button>
                  </>
                )}
              </p>
            )}
          </form>
        ) : null}
        {!compose &&
          messages.map((m) => (
            <MessageRow
              key={m.engineId}
              message={m}
              onOpen={() => void selectMessage(m)}
            />
          ))}
      </section>

      <section style={sx.readPane}>
        {open ? (
          <>
            <h2>{open.subject}</h2>
            <p>
              From {open.from?.name ?? ""} &lt;{open.from?.email}&gt; · {fmtTime(open.date)}
            </p>
            <div style={sx.actions}>
              <button onClick={() => void runAction("archive", open.engineId)}>Archive</button>
              <button onClick={() => void runAction("trash", open.engineId)}>Delete</button>
            </div>
            <pre style={sx.body}>{open.textBody ?? open.htmlBody?.replace(/<[^>]+>/g, "") ?? ""}</pre>
          </>
        ) : (
          <p style={sx.placeholder}>Select a message</p>
        )}
      </section>
    </div>
  );
}
