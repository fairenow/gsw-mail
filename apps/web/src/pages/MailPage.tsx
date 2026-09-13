import { useCallback, useEffect, useRef, useState } from "react";
import { api, type Account, type FullMessage, type MessageSummary, type ProductSettings, type SendResult } from "../api";
import { plainTextToHtml, richTextToText } from "../components/RichTextEditor";
import { type Folder } from "../components/folders";
import { ComposeWindow, type ComposeMode } from "../components/mail/ComposeWindow";
import { EmptyReader } from "../components/mail/EmptyReader";
import { MailSidebar } from "../components/mail/MailSidebar";
import { MailTopBar } from "../components/mail/MailTopBar";
import { MessageListHeader } from "../components/mail/MessageListHeader";
import { MessageReader } from "../components/mail/MessageReader";
import { MessageRow } from "../components/mail/MessageRow";

type MobileView = "folders" | "messages" | "reader";
const defaultTemplateKey = "gsw_default";
const parseRecipients = (value: string) => value.split(",").map((item) => item.trim()).filter(Boolean);
const uniqueRecipients = (values: string[], accountAddress: string) => {
  const seen = new Set<string>();
  return values.filter((value) => { const normalized = value.toLowerCase(); if (!normalized || normalized === accountAddress.toLowerCase() || seen.has(normalized)) return false; seen.add(normalized); return true; });
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem("gsw-mail-sidebar-collapsed") === "true");
  const readTimers = useRef(new Map<string, number>());
  const [compose, setCompose] = useState(false);
  const [composeMinimized, setComposeMinimized] = useState(false);
  const [composeMode, setComposeMode] = useState<ComposeMode>("new");
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");
  const [subject, setSubject] = useState("");
  const [html, setHtml] = useState("");
  const [signature, setSignature] = useState<ProductSettings["signature"] | null>(null);
  const [profileImageUrl, setProfileImageUrl] = useState("");
  const [inReplyTo, setInReplyTo] = useState<string | undefined>();
  const [references, setReferences] = useState<string | undefined>();
  const [sending, setSending] = useState(false);
  const [lastSend, setLastSend] = useState<SendResult | null>(null);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [draftDirty, setDraftDirty] = useState(false);
  const [draftSaveBlocked, setDraftSaveBlocked] = useState(false);
  const [draftStatus, setDraftStatus] = useState<"idle" | "saving" | "saved" | "notSaved">("idle");
  const [sendError, setSendError] = useState<string | null>(null);
  const [sendRequestId, setSendRequestId] = useState<string | null>(null);

  const loadFolder = useCallback(async (accountId: string, name: Folder) => {
    setError(null);
    try { setMessages(await api.messages(accountId, name)); } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  }, []);
  useEffect(() => { void api.accounts().then((rows) => { setAccounts(rows); if (rows[0]) { setAccount(rows[0]); void loadFolder(rows[0].id, "Inbox"); } }).catch((err) => setError(err instanceof Error ? err.message : String(err))); }, [loadFolder]);
  useEffect(() => { void api.settings().then((settings) => { setSignature(settings.signature); setProfileImageUrl(typeof settings.general.profileImageUrl === "string" ? settings.general.profileImageUrl : ""); }).catch(() => undefined); }, []);
  useEffect(() => () => readTimers.current.forEach((timer) => window.clearTimeout(timer)), []);

  const signatureFor = (mode: ComposeMode) => {
    if (!signature?.enabled || (mode === "new" && !signature.onNew) || ((mode === "reply" || mode === "replyAll") && !signature.onReply) || (mode === "forward" && !signature.onForward)) return "";
    return signature.signatureHtml ? `<div class="gsw-signature">${signature.signatureHtml}</div><div><br></div>` : "";
  };
  const selectAccount = (id: string) => { const next = accounts.find((item) => item.id === id); if (!next) return; setAccount(next); setOpen(null); setLastSend(null); setMobileView("folders"); void loadFolder(next.id, folder); };
  const selectFolder = (name: Folder) => { setFolder(name); setOpen(null); setMobileView("messages"); if (account) void loadFolder(account.id, name); };
  const refresh = () => { if (account) void loadFolder(account.id, folder); };
  const toggleSidebar = () => { if (window.matchMedia("(max-width: 699px)").matches) { setMobileView((current) => current === "folders" ? "messages" : "folders"); return; } setSidebarCollapsed((current) => { const next = !current; localStorage.setItem("gsw-mail-sidebar-collapsed", String(next)); return next; }); };
  const runSearch = async () => { if (!account) return; if (!search.trim()) { refresh(); return; } try { setError(null); setMessages(await api.search(account.id, search.trim())); setOpen(null); setMobileView("messages"); } catch (err) { setError(err instanceof Error ? err.message : String(err)); } };

  const openDraft = (draft: FullMessage) => {
    setComposeMode("new"); setCompose(true); setComposeMinimized(false); setDraftId(draft.engineId); setDraftDirty(false); setDraftSaveBlocked(false); setDraftStatus("saved"); setLastSend(null); setSendError(null); setSendRequestId(null);
    setTo(draft.to?.map((item) => item.email).join(", ") ?? ""); setCc(draft.cc?.map((item) => item.email).join(", ") ?? ""); setBcc(""); setSubject(draft.subject); setHtml(draft.htmlBody ?? plainTextToHtml(messageBody(draft))); setInReplyTo(draft.headers?.["In-Reply-To"]); setReferences(draft.headers?.References);
  };
  const selectMessage = async (message: MessageSummary) => {
    if (!account) return;
    try { const full = await api.message(account.id, message.engineId); if (folder === "Drafts") { openDraft(full); return; } setOpen(full); setMobileView("reader"); if (!message.read) { const timer = window.setTimeout(() => { void api.read(account.id, message.engineId, true).then(() => { setMessages((prev) => prev.map((item) => item.engineId === message.engineId ? { ...item, read: true } : item)); setOpen((current) => current?.engineId === message.engineId ? { ...current, read: true } : current); }).catch((err) => setError(err instanceof Error ? err.message : String(err))); readTimers.current.delete(message.engineId); }, 400); readTimers.current.set(message.engineId, timer); } } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  };
  const toggleRead = async (message: MessageSummary | FullMessage) => { if (!account) return; const read = !message.read; const pending = readTimers.current.get(message.engineId); if (pending !== undefined) { window.clearTimeout(pending); readTimers.current.delete(message.engineId); } try { await api.read(account.id, message.engineId, read); setMessages((prev) => prev.map((item) => item.engineId === message.engineId ? { ...item, read } : item)); setOpen((current) => current?.engineId === message.engineId ? { ...current, read } : current); } catch (err) { setError(err instanceof Error ? err.message : String(err)); } };
  const runAction = async (action: "archive" | "trash", engineId: string) => { if (!account) return; try { await (action === "archive" ? api.archive(account.id, engineId) : api.trash(account.id, engineId)); setOpen(null); setMobileView("messages"); await loadFolder(account.id, folder); } catch (err) { setError(err instanceof Error ? err.message : String(err)); } };

  const openCompose = (mode: ComposeMode = "new", message?: FullMessage) => {
    setComposeMode(mode); setLastSend(null); setSendError(null); setSendRequestId(null); setCompose(true); setComposeMinimized(false); setDraftId(null); setDraftDirty(false); setDraftSaveBlocked(false); setDraftStatus("idle");
    const currentAccount = account;
    if (!message) {
      const stored = mode === "new" && currentAccount ? localStorage.getItem(localDraftKey(currentAccount.id)) : null;
      if (stored) { try { const local = JSON.parse(stored) as { to?: string; cc?: string; bcc?: string; subject?: string; html?: string; text?: string; inReplyTo?: string; references?: string; mode?: ComposeMode }; setComposeMode(local.mode ?? "new"); setTo(local.to ?? ""); setCc(local.cc ?? ""); setBcc(local.bcc ?? ""); setSubject(local.subject ?? ""); setHtml(local.html ?? plainTextToHtml(local.text ?? "")); setInReplyTo(local.inReplyTo); setReferences(local.references); setDraftDirty(true); setDraftSaveBlocked(false); setDraftStatus("notSaved"); return; } catch { if (currentAccount) localStorage.removeItem(localDraftKey(currentAccount.id)); } }
      setTo(""); setCc(""); setBcc(""); setSubject(""); setHtml(signatureFor("new")); setInReplyTo(undefined); setReferences(undefined); return;
    }
    const messageId = message.headers?.["Message-ID"]; const priorReferences = message.headers?.References?.trim(); setInReplyTo(mode === "forward" ? undefined : messageId); setReferences(mode === "forward" ? undefined : [priorReferences, messageId].filter(Boolean).join(" ") || undefined);
    if (mode === "forward") { setTo(""); setCc(""); setBcc(""); setSubject(subjectWithPrefix(message.subject || "(no subject)", "Fwd")); setHtml(`${signatureFor("forward")}<div>---------- Forwarded message ----------<br>From: ${message.from?.name || ""} &lt;${message.from?.email || ""}&gt;<br>Date: ${new Date(message.date).toLocaleString()}<br>Subject: ${message.subject || "(no subject)"}<br>To: ${message.to?.map((item) => item.email).join(", ") || ""}<br><br>${messageBody(message)}</div>`); }
    else { const replyTo = uniqueRecipients([message.from?.email || "", ...(message.to ?? []).map((item) => item.email)], account?.address ?? ""); const replyCc = uniqueRecipients((message.cc ?? []).map((item) => item.email), account?.address ?? ""); const quote = `<div>On ${new Date(message.date).toLocaleString()}, ${message.from?.email || "the sender"} wrote:</div><blockquote>${plainTextToHtml(messageBody(message))}</blockquote>`; setTo((mode === "replyAll" ? replyTo : [message.from?.email || ""]).filter(Boolean).join(", ")); setCc(mode === "replyAll" ? replyCc.join(", ") : ""); setBcc(""); setSubject(subjectWithPrefix(message.subject || "(no subject)", "Re")); setHtml(signature?.position === "afterQuotedText" ? `${quote}${signatureFor(mode)}` : `${signatureFor(mode)}${quote}`); }
  };

  const draftPayload = useCallback((): import("../api").DraftInput | null => account ? { accountId: account.id, to: parseRecipients(to), cc: parseRecipients(cc), bcc: parseRecipients(bcc), subject, textBody: richTextToText(html), htmlBody: html, inReplyTo, references, mode: composeMode, templateKey: defaultTemplateKey } : null, [account, bcc, cc, composeMode, html, inReplyTo, references, subject, to]);
  const saveDraft = useCallback(async (force = false): Promise<string | null> => { if (!account || !compose || (!draftDirty && !force)) return draftId; const payload = draftPayload(); if (!payload) return draftId; setDraftStatus("saving"); try { const savedId = draftId ? (await api.updateDraft(draftId, payload)).engineId : (await api.createDraft(payload)).engineId; localStorage.removeItem(localDraftKey(account.id)); setDraftId(savedId); setDraftDirty(false); setDraftSaveBlocked(false); setDraftStatus("saved"); return savedId; } catch { localStorage.setItem(localDraftKey(account.id), JSON.stringify({ mode: composeMode, to, cc, bcc, subject, html, inReplyTo, references })); setDraftSaveBlocked(true); setDraftStatus("notSaved"); return null; } }, [account, bcc, cc, compose, composeMode, draftDirty, draftId, draftPayload, html, inReplyTo, references, subject, to]);
  useEffect(() => { if (!compose || !draftDirty || draftSaveBlocked) return; const timer = window.setTimeout(() => { void saveDraft(); }, 1500); return () => window.clearTimeout(timer); }, [compose, draftDirty, draftSaveBlocked, to, cc, bcc, subject, html, saveDraft]);
  useEffect(() => { const saveOnHide = () => { if (document.visibilityState === "hidden") void saveDraft(); }; document.addEventListener("visibilitychange", saveOnHide); return () => document.removeEventListener("visibilitychange", saveOnHide); }, [saveDraft]);
  const runSend = async () => { if (!account) return; try { setError(null); setSendError(null); setSending(true); const clientRequestId = sendRequestId ?? crypto.randomUUID(); setSendRequestId(clientRequestId); const savedId = await saveDraft(true); const result = savedId ? await api.sendDraft(savedId, account.id, clientRequestId, composeMode, defaultTemplateKey) : await api.send(account.id, parseRecipients(to), { cc: parseRecipients(cc), bcc: parseRecipients(bcc), subject, textBody: richTextToText(html), htmlBody: html, inReplyTo, references, mode: composeMode, clientRequestId, templateKey: defaultTemplateKey }); setLastSend(result); setSendError(null); setCompose(false); setComposeMinimized(false); setDraftId(null); setDraftDirty(false); setDraftSaveBlocked(false); setSendRequestId(null); localStorage.removeItem(localDraftKey(account.id)); setTo(""); setCc(""); setBcc(""); setSubject(""); setHtml(""); setInReplyTo(undefined); setReferences(undefined); } catch (err) { const message = err instanceof Error ? err.message : String(err); setSendError(message); setError(message); } finally { setSending(false); } };
  const runUndo = async () => { if (!lastSend) return; try { const result = await api.cancelSend(lastSend.sendId); setLastSend({ ...lastSend, status: result.status }); } catch (err) { setError(err instanceof Error ? err.message : String(err)); } };

  const unreadCount = messages.filter((message) => !message.read).length;
  return <div className="gsw-mail-shell">
    <MailTopBar account={account} accounts={accounts} profileImageUrl={profileImageUrl} search={search} onSearchChange={setSearch} onSearch={() => void runSearch()} onSelectAccount={selectAccount} sidebarCollapsed={sidebarCollapsed} onToggleSidebar={toggleSidebar} />
    <main className={`gsw-mail-body ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <MailSidebar account={account} profileImageUrl={profileImageUrl} folder={folder} unreadCount={unreadCount} composeOpen={compose} mobileHidden={mobileView !== "folders"} collapsed={sidebarCollapsed} onSelectFolder={selectFolder} onToggleCompose={() => openCompose()} />
      <section className={`gsw-message-list ${mobileView !== "messages" ? "" : "mobile-open"}`} aria-label={`${folder} messages`}><MessageListHeader folder={folder} count={messages.length} onRefresh={refresh} />{error && <p className="gsw-errors">{error}</p>}{messages.length ? messages.map((message) => <MessageRow key={message.engineId} message={message} active={open?.engineId === message.engineId} onOpen={() => void selectMessage(message)} onToggleRead={() => void toggleRead(message)} />) : <div className="gsw-list-empty"><span aria-hidden="true">✉</span><strong>No messages here</strong><p>Your {folder.toLowerCase()} is clear.</p></div>}</section>
      <section className={`gsw-reading-pane ${mobileView === "reader" ? "mobile-open" : ""} ${sidebarCollapsed ? "sidebar-collapsed" : ""}`} aria-label="Message reader">{open ? <MessageReader message={open} accountAddress={account?.address} onBack={() => setMobileView("messages")} onReply={() => openCompose("reply", open)} onReplyAll={() => openCompose("replyAll", open)} onForward={() => openCompose("forward", open)} onArchive={() => void runAction("archive", open.engineId)} onTrash={() => void runAction("trash", open.engineId)} onToggleRead={() => void toggleRead(open)} /> : <EmptyReader />}</section>
    </main>
    {compose && <ComposeWindow mode={composeMode} minimized={composeMinimized} to={to} cc={cc} bcc={bcc} subject={subject} html={html} sending={sending} draftStatus={draftStatus} sendError={sendError} sendNote={lastSend ? `Sent · ${lastSend.status}` : undefined} onToChange={(value) => { setTo(value); setDraftDirty(true); setDraftSaveBlocked(false); setSendRequestId(null); }} onCcChange={(value) => { setCc(value); setDraftDirty(true); setDraftSaveBlocked(false); setSendRequestId(null); }} onBccChange={(value) => { setBcc(value); setDraftDirty(true); setDraftSaveBlocked(false); setSendRequestId(null); }} onSubjectChange={(value) => { setSubject(value); setDraftDirty(true); setDraftSaveBlocked(false); setSendRequestId(null); }} onHtmlChange={(value) => { setHtml(value); setDraftDirty(true); setDraftSaveBlocked(false); setSendRequestId(null); }} onMinimize={() => { void saveDraft(true); setComposeMinimized(true); }} onClose={() => { void saveDraft(true); setCompose(false); }} onSubmit={() => void runSend()} onRetry={() => void runSend()} onUndo={lastSend ? () => void runUndo() : undefined} />}
  </div>;
}
