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
const localDraftKey = (accountId: string) => `gsw-mail-draft:${accountId}`;

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
  const [composeMinimized, setComposeMinimized] = useState(false);
  const [composeMode, setComposeMode] = useState<ComposeMode>("new");
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState("");
  const [text, setText] = useState("");
  const [inReplyTo, setInReplyTo] = useState<string | undefined>();
  const [references, setReferences] = useState<string | undefined>();
  const [sending, setSending] = useState(false);
  const [lastSend, setLastSend] = useState<SendResult | null>(null);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [draftDirty, setDraftDirty] = useState(false);
  const [draftStatus, setDraftStatus] = useState<"idle" | "saving" | "saved" | "notSaved">("idle");

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

  const openDraft = (draft: FullMessage) => {
    setComposeMode("new"); setCompose(true); setComposeMinimized(false); setDraftId(draft.engineId); setDraftDirty(false); setDraftStatus("saved"); setLastSend(null);
    setTo(draft.to?.map((item) => item.email).join(", ") ?? ""); setCc(draft.cc?.map((item) => item.email).join(", ") ?? ""); setSubject(draft.subject); setText(messageBody(draft));
    setInReplyTo(draft.headers?.["In-Reply-To"]); setReferences(draft.headers?.References);
  };

  const selectMessage = async (message: MessageSummary) => {
    if (!account) return;
    try {
      const full = await api.message(account.id, message.engineId);
      if (folder === "Drafts") { openDraft(full); return; }
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
    setComposeMode(mode); setLastSend(null); setCompose(true); setComposeMinimized(false); setDraftId(null); setDraftDirty(mode !== "new"); setDraftStatus("idle");
    const currentAccount = account;
    if (!message) {
      const stored = mode === "new" && currentAccount ? localStorage.getItem(localDraftKey(currentAccount.id)) : null;
      if (stored) {
        try {
          const local = JSON.parse(stored) as { to?: string; cc?: string; subject?: string; text?: string; inReplyTo?: string; references?: string; mode?: ComposeMode };
          setComposeMode(local.mode ?? "new"); setTo(local.to ?? ""); setCc(local.cc ?? ""); setSubject(local.subject ?? ""); setText(local.text ?? ""); setInReplyTo(local.inReplyTo); setReferences(local.references); setDraftDirty(true); setDraftStatus("notSaved");
          return;
        } catch {
          if (currentAccount) localStorage.removeItem(localDraftKey(currentAccount.id));
        }
      }
      setTo(""); setCc(""); setSubject(""); setText(""); setInReplyTo(undefined); setReferences(undefined); return;
    }
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

  const draftPayload = useCallback((): import("../api").DraftInput | null => {
    if (!account) return null;
    return { accountId: account.id, to: parseRecipients(to), cc: parseRecipients(cc), subject, textBody: text, inReplyTo, references };
  }, [account, cc, inReplyTo, references, subject, text, to]);

  const saveDraft = useCallback(async (force = false): Promise<string | null> => {
    if (!account || !compose || (!draftDirty && !force)) return draftId;
    const payload = draftPayload();
    if (!payload) return draftId;
    setDraftStatus("saving");
    try {
      const savedId = draftId ?? (await api.createDraft(payload)).engineId;
      if (draftId) await api.updateDraft(savedId, payload);
      localStorage.removeItem(localDraftKey(account.id));
      setDraftId(savedId); setDraftDirty(false); setDraftStatus("saved");
      return savedId;
    } catch {
      localStorage.setItem(localDraftKey(account.id), JSON.stringify({ mode: composeMode, to, cc, subject, text, inReplyTo, references }));
      setDraftStatus("notSaved");
      return null;
    }
  }, [account, cc, compose, composeMode, draftDirty, draftId, draftPayload, inReplyTo, references, subject, text, to]);

  useEffect(() => {
    if (!compose || !draftDirty) return;
    const timer = window.setTimeout(() => { void saveDraft(); }, 1500);
    return () => window.clearTimeout(timer);
  }, [compose, draftDirty, to, cc, subject, text, saveDraft]);

  useEffect(() => {
    const saveOnHide = () => { if (document.visibilityState === "hidden") void saveDraft(true); };
    document.addEventListener("visibilitychange", saveOnHide);
    return () => document.removeEventListener("visibilitychange", saveOnHide);
  }, [saveDraft]);

  const runSend = async () => {
    if (!account) return;
    try {
      setError(null); setSending(true);
      const clientRequestId = crypto.randomUUID();
      const savedId = await saveDraft(true);
      const result = savedId
        ? await api.sendDraft(savedId, account.id, clientRequestId, composeMode)
        : await api.send(account.id, parseRecipients(to), { cc: parseRecipients(cc), subject, textBody: text, inReplyTo, references, mode: composeMode, clientRequestId });
      setLastSend(result); setCompose(false); setComposeMinimized(false); setSending(false); setDraftId(null); setDraftDirty(false);
      localStorage.removeItem(localDraftKey(account.id));
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
    {compose && <ComposeWindow mode={composeMode} minimized={composeMinimized} to={to} cc={cc} subject={subject} text={text} sending={sending} draftStatus={draftStatus} sendNote={lastSend ? `Sent · ${lastSend.status}` : undefined} onToChange={(value) => { setTo(value); setDraftDirty(true); }} onCcChange={(value) => { setCc(value); setDraftDirty(true); }} onSubjectChange={(value) => { setSubject(value); setDraftDirty(true); }} onTextChange={(value) => { setText(value); setDraftDirty(true); }} onMinimize={() => { void saveDraft(true); setComposeMinimized(true); }} onClose={() => { void saveDraft(true); setCompose(false); }} onSubmit={() => void runSend()} onUndo={lastSend ? () => void runUndo() : undefined} />}
  </div>;
}
