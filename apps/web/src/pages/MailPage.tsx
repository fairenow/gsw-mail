import { useCallback, useEffect, useState } from "react";
import { api, type Account, type FullMessage, type MessageSummary, type SendResult } from "../api";
import { type Folder } from "../components/folders";
import { ComposeWindow, type ComposeMode } from "../components/mail/ComposeWindow";
import { EmptyReader } from "../components/mail/EmptyReader";
import { MailSidebar } from "../components/mail/MailSidebar";
import { MailTopBar } from "../components/mail/MailTopBar";
import { MessageListHeader } from "../components/mail/MessageListHeader";
import { MessageReader } from "../components/mail/MessageReader";
import { MessageRow } from "../components/mail/MessageRow";

type MobileView = "folders" | "messages" | "reader";

const parseRecipients = (value: string) => value.split(",").map((item) => item.trim()).filter(Boolean);
const uniqueRecipients = (values: string[], accountAddress: string) => {
  const seen = new Set<string>();
  return values.filter((value) => {
    const normalized = value.toLowerCase();
    if (!normalized || normalized === accountAddress.toLowerCase() || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
};
const subjectWithPrefix = (subject: string, prefix: "Re" | "Fwd") => subject.match(new RegExp(`^${prefix}:`, "i")) ? subject : `${prefix}: ${subject}`;
const messageBody = (message: FullMessage) => message.textBody?.trim() || message.htmlBody?.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>|<[^>]+>/gi, "").trim() || "";

export function MailPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [account, setAccount] = useState<Account | null>(null);
  const [folder, setFolder] = useState<Folder>("Inbox");
  const [messages, setMessages] = useState<MessageSummary[]>([]);
  const [open, setOpen] = useState<FullMessage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [mobileView, setMobileView] = useState<MobileView>("folders");

  const [compose, setCompose] = useState(false);
  const [composeMode, setComposeMode] = useState<ComposeMode>("new");
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState("");
  const [text, setText] = useState("");
  const [inReplyTo, setInReplyTo] = useState<string | undefined>();
  const [references, setReferences] = useState<string | undefined>();
  const [sending, setSending] = useState(false);
  const [lastSend, setLastSend] = useState<SendResult | null>(null);

  const loadFolder = useCallback(async (accountId: string, name: Folder) => {
    setError(null);
    try { setMessages(await api.messages(accountId, name)); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  }, []);

  useEffect(() => {
    api.accounts().then((rows) => {
      setAccounts(rows);
      if (rows[0]) { setAccount(rows[0]); void loadFolder(rows[0].id, "Inbox"); }
    }).catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [loadFolder]);

  const selectAccount = (id: string) => {
    const next = accounts.find((item) => item.id === id);
    if (!next) return;
    setAccount(next); setOpen(null); setLastSend(null); setMobileView("folders"); void loadFolder(next.id, folder);
  };

  const selectFolder = (name: Folder) => {
    setFolder(name); setOpen(null); setMobileView("messages");
    if (account) void loadFolder(account.id, name);
  };

  const refresh = () => { if (account) void loadFolder(account.id, folder); };

  const runSearch = async () => {
    if (!account) return;
    if (!search.trim()) { refresh(); return; }
    try { setError(null); setMessages(await api.search(account.id, search.trim())); setOpen(null); setMobileView("messages"); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  };

  const selectMessage = async (message: MessageSummary) => {
    if (!account) return;
    try {
      const full = await api.message(account.id, message.engineId);
      setOpen(full); setMobileView("reader");
      if (!message.read) {
        await api.read(account.id, message.engineId, true);
        setMessages((prev) => prev.map((item) => item.engineId === message.engineId ? { ...item, read: true } : item));
      }
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  };

  const runAction = async (action: "archive" | "trash", engineId: string) => {
    if (!account) return;
    try { await (action === "archive" ? api.archive(account.id, engineId) : api.trash(account.id, engineId)); setOpen(null); setMobileView("messages"); await loadFolder(account.id, folder); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  };

  const openCompose = (mode: ComposeMode = "new", message?: FullMessage) => {
    setComposeMode(mode); setLastSend(null); setCompose(true);
    if (!message) { setTo(""); setCc(""); setSubject(""); setText(""); setInReplyTo(undefined); setReferences(undefined); return; }
    const messageId = message.headers?.["Message-ID"];
    const priorReferences = message.headers?.References?.trim();
    setInReplyTo(mode === "forward" ? undefined : messageId);
    setReferences(mode === "forward" ? undefined : [priorReferences, messageId].filter(Boolean).join(" ") || undefined);
    if (mode === "forward") {
      setTo(""); setCc(""); setSubject(subjectWithPrefix(message.subject || "(no subject)", "Fwd"));
      setText(`---------- Forwarded message ----------\nFrom: ${message.from?.name || ""} <${message.from?.email || ""}>\nDate: ${new Date(message.date).toLocaleString()}\nSubject: ${message.subject || "(no subject)"}\nTo: ${message.to?.map((item) => item.email).join(", ") || ""}\n\n${messageBody(message)}`);
    } else {
      const replyTo = uniqueRecipients([message.from?.email || "", ...(message.to ?? []).map((item) => item.email)], account?.address ?? "");
      const replyCc = uniqueRecipients((message.cc ?? []).map((item) => item.email), account?.address ?? "");
      setTo((mode === "replyAll" ? replyTo : [message.from?.email || ""]).filter(Boolean).join(", "));
      setCc(mode === "replyAll" ? replyCc.join(", ") : "");
      setSubject(subjectWithPrefix(message.subject || "(no subject)", "Re"));
      setText(`\n\nOn ${new Date(message.date).toLocaleString()}, ${message.from?.email || "the sender"} wrote:\n> ${messageBody(message).split("\n").join("\n> ")}`);
    }
  };

  const runSend = async () => {
    if (!account) return;
    try {
      setError(null); setSending(true);
      const result = await api.send(account.id, parseRecipients(to), { cc: parseRecipients(cc), subject, textBody: text, inReplyTo, references, clientRequestId: crypto.randomUUID() });
      setLastSend(result); setCompose(false); setSending(false);
      setTo(""); setCc(""); setSubject(""); setText(""); setInReplyTo(undefined); setReferences(undefined);
    } catch (err) { setSending(false); setError(err instanceof Error ? err.message : String(err)); }
  };

  const runUndo = async () => {
    if (!lastSend) return;
    try { const result = await api.cancelSend(lastSend.sendId); setLastSend({ ...lastSend, status: result.status }); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  };

  const unreadCount = messages.filter((message) => !message.read).length;
  return <div className="gsw-mail-shell">
    <MailTopBar account={account} accounts={accounts} search={search} onSearchChange={setSearch} onSearch={() => void runSearch()} onSelectAccount={selectAccount} />
    <main className="gsw-mail-body">
      <MailSidebar account={account} folder={folder} unreadCount={unreadCount} composeOpen={compose} mobileHidden={mobileView !== "folders"} onSelectFolder={selectFolder} onToggleCompose={() => openCompose()} />
      <section className={`gsw-message-list ${mobileView !== "messages" ? "" : "mobile-open"}`} aria-label={`${folder} messages`}>
        <MessageListHeader folder={folder} count={messages.length} onRefresh={refresh} />
        {error && <p className="gsw-errors">{error}</p>}
        {messages.length ? messages.map((message) => <MessageRow key={message.engineId} message={message} active={open?.engineId === message.engineId} onOpen={() => void selectMessage(message)} />) : <div className="gsw-list-empty"><span aria-hidden="true">✉</span><strong>No messages here</strong><p>Your {folder.toLowerCase()} is clear.</p></div>}
      </section>
      <section className={`gsw-reading-pane ${mobileView === "reader" ? "mobile-open" : ""}`} aria-label="Message reader">
        {open ? <MessageReader message={open} accountAddress={account?.address} onBack={() => setMobileView("messages")} onReply={() => openCompose("reply", open)} onReplyAll={() => openCompose("replyAll", open)} onForward={() => openCompose("forward", open)} onArchive={() => void runAction("archive", open.engineId)} onTrash={() => void runAction("trash", open.engineId)} /> : <EmptyReader />}
      </section>
    </main>
    {compose && <ComposeWindow mode={composeMode} to={to} cc={cc} subject={subject} text={text} sending={sending} sendNote={lastSend ? `Sent · ${lastSend.status}` : undefined} onToChange={setTo} onCcChange={setCc} onSubjectChange={setSubject} onTextChange={setText} onClose={() => setCompose(false)} onSubmit={() => void runSend()} onUndo={lastSend ? () => void runUndo() : undefined} />}
  </div>;
}
