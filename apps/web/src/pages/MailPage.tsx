import { useCallback, useEffect, useRef, useState } from "react";
import { Inbox } from "lucide-react";
import { api, type BulkMailAction, type ComposeAttachment, type FullMessage, type MessageSummary, type ProductSettings, type SendResult } from "../api";
import { useAppShell } from "../components/AppShell";
import { plainTextToHtml, richTextToText, sanitizeHtml } from "../components/RichTextEditor";
import { FOLDERS, type Folder } from "../components/folders";
import { ComposeWindow, type ComposeMode } from "../components/mail/ComposeWindow";
import { EmptyReader } from "../components/mail/EmptyReader";
import { MailSidebar } from "../components/mail/MailSidebar";
import { MessageListHeader } from "../components/mail/MessageListHeader";
import { MessageReader } from "../components/mail/MessageReader";
import { MessageRow } from "../components/mail/MessageRow";

type MobileView = "messages" | "reader";
const pageSize = 50;
const fallbackTemplateKey = "gsw_default";
const parseRecipients = (value: string) => value.split(",").map((item) => item.trim()).filter(Boolean);
const draftRecipients = (value: string) => parseRecipients(value).filter((item) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item));
const uniqueRecipients = (values: string[], accountAddress: string) => {
  const seen = new Set<string>();
  return values.filter((value) => { const normalized = value.toLowerCase(); if (!normalized || normalized === accountAddress.toLowerCase() || seen.has(normalized)) return false; seen.add(normalized); return true; });
};
const subjectWithPrefix = (subject: string, prefix: "Re" | "Fwd") => subject.match(new RegExp(`^${prefix}:`, "i")) ? subject : `${prefix}: ${subject}`;
const timedMailRequest = async <T,>(label: string, request: () => Promise<T>): Promise<T> => {
  const started = performance.now();
  try { return await request(); }
  finally { const elapsed = performance.now() - started; if (elapsed > 500) console.warn(`[mail] ${label} took ${Math.round(elapsed)}ms`); }
};
const messageHtml = (message: FullMessage) => sanitizeHtml(message.htmlBody || plainTextToHtml(message.textBody || ""));
const messageBody = (message: FullMessage) => message.textBody?.trim() || message.htmlBody?.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>|<[^>]+>/gi, "").trim() || "";
const localDraftKey = (accountId: string) => `gsw-mail-draft:${accountId}`;
const emptyFolderCounts = (): Record<Folder, { total: number; unread: number }> => Object.fromEntries(FOLDERS.map((name) => [name, { total: 0, unread: 0 }])) as Record<Folder, { total: number; unread: number }>;
const normalizeComposeHtml = (value: string) => {
  let normalized = sanitizeHtml(value);
  const signaturePattern = /<div[^>]*class=["'][^"']*\bgsw-signature\b[^"']*["'][^>]*>[\s\S]*?<\/div>(?:<div[^>]*>\s*<br\s*\/?>\s*<\/div>)?/gi;
  const signatures = normalized.match(signaturePattern) ?? [];
  if (signatures.length < 2) return normalized;
  const keep = signatures[signatures.length - 1];
  normalized = normalized.replace(signaturePattern, "");
  normalized = normalized.replace(/^\s*(?:<div[^>]*>\s*)?(?:Hello,?|Hello)(?:\s|&nbsp;|<br\s*\/?>)*(?:<\/div>)?/i, "");
  return `${normalized}${keep}`;
};

export function MailPage() {
  const { account, accounts, profileImageUrl, selectAccount: shellSelectAccount, configureTopBar } = useAppShell();
  const [folder, setFolder] = useState<Folder>("Inbox");
  const [folderCounts, setFolderCounts] = useState<Record<Folder, { total: number; unread: number }>>(emptyFolderCounts);
  const [messages, setMessages] = useState<MessageSummary[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [open, setOpen] = useState<FullMessage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [mobileView, setMobileView] = useState<MobileView>("messages");
  const [foldersOpen, setFoldersOpen] = useState(false);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [searchResults, setSearchResults] = useState(false);
  const listRequest = useRef(0);
  const listScroll = useRef<HTMLDivElement>(null);
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
  const [attachments, setAttachments] = useState<ComposeAttachment[]>([]);
  const [signature, setSignature] = useState<ProductSettings["signature"] | null>(null);
  const [templateKey, setTemplateKey] = useState(fallbackTemplateKey);
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

  const loadFolder = useCallback(async (accountId: string, name: Folder, nextPage = 0) => {
    const request = ++listRequest.current;
    setError(null); setLoading(true); setSelectedIds(new Set());
    try {
      const result = await timedMailRequest(`folder:${name}`, () => api.messages(accountId, name, pageSize, nextPage * pageSize));
      if (request !== listRequest.current) return;
      setMessages(result); setPage(nextPage); setSearchResults(false); listScroll.current?.scrollTo(0, 0);
    } catch (err) { if (request === listRequest.current) setError(err instanceof Error ? err.message : String(err)); }
    finally { if (request === listRequest.current) setLoading(false); }
  }, []);
  const loadFolderCounts = useCallback(async (accountId: string) => {
    try { const stats = await timedMailRequest("mailbox-stats", () => api.mailboxStats(accountId)); setFolderCounts(Object.fromEntries(FOLDERS.map((name) => [name, stats[name] ?? { total: 0, unread: 0 }])) as Record<Folder, { total: number; unread: number }>); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  }, []);
  const loadAccount = useCallback(async (accountId: string, name: Folder) => { await timedMailRequest("account-load", async () => { await Promise.all([loadFolder(accountId, name), loadFolderCounts(accountId)]); }); }, [loadFolder, loadFolderCounts]);
  const adjustFolderCounts = useCallback((source: Folder, destination: Folder | undefined, message: MessageSummary | FullMessage | undefined) => {
    if (!message || source === destination) return;
    const unread = message.read ? 0 : 1;
    setFolderCounts((current) => {
      const next = { ...current, [source]: { ...current[source], total: Math.max(0, current[source].total - 1), unread: Math.max(0, current[source].unread - unread) } };
      if (destination) next[destination] = { ...current[destination], total: current[destination].total + 1, unread: current[destination].unread + unread };
      return next;
    });
  }, []);
  useEffect(() => { if (account) void loadAccount(account.id, "Inbox"); }, [account, loadAccount]);
  useEffect(() => { void api.settings().then((settings) => { setSignature(settings.signature); setTemplateKey(settings.general.templateKey === "bible_reader" ? "bible_reader" : fallbackTemplateKey); }).catch(() => undefined); }, []);
  useEffect(() => () => readTimers.current.forEach((timer) => window.clearTimeout(timer)), []);
  useEffect(() => { if (!foldersOpen) return; const closeFolders = (event: KeyboardEvent) => { if (event.key === "Escape") setFoldersOpen(false); }; window.addEventListener("keydown", closeFolders); return () => window.removeEventListener("keydown", closeFolders); }, [foldersOpen]);

  const signatureFor = (mode: ComposeMode) => {
    if (!signature?.enabled || (mode === "new" && !signature.onNew) || ((mode === "reply" || mode === "replyAll") && !signature.onReply) || (mode === "forward" && !signature.onForward)) return "";
    return signature.signatureHtml ? `<div class="gsw-signature">${signature.signatureHtml}</div><div><br></div>` : "";
  };

  const selectAccount = useCallback((id: string) => { const next = accounts.find((item) => item.id === id); if (!next) return; shellSelectAccount(id); setFolder("Inbox"); setSearch(""); setOpen(null); setSelectedIds(new Set()); setLastSend(null); setMobileView("messages"); setFoldersOpen(false); }, [accounts, shellSelectAccount]);
  const selectFolder = (name: Folder) => { setFolder(name); setSearch(""); setFoldersOpen(false); setOpen(null); setSelectedIds(new Set()); setMobileView("messages"); if (account) void loadFolder(account.id, name); };
  const refresh = useCallback(() => { if (account) { void loadFolder(account.id, folder); void loadFolderCounts(account.id); } }, [account, folder, loadFolder, loadFolderCounts]);
  const toggleSidebar = useCallback(() => { if (window.matchMedia("(max-width: 1099px)").matches) { setFoldersOpen((current) => !current); return; } setSidebarCollapsed((current) => { const next = !current; localStorage.setItem("gsw-mail-sidebar-collapsed", String(next)); return next; }); }, []);
  const runSearch = useCallback(async () => {
    if (!account) return;
    if (!search.trim()) { refresh(); return; }
    const request = ++listRequest.current; setLoading(true); setError(null); setSelectedIds(new Set());
    try { const result = await api.search(account.id, search.trim()); if (request !== listRequest.current) return; setMessages(result); setPage(0); setSearchResults(true); setOpen(null); setMobileView("messages"); setFoldersOpen(false); listScroll.current?.scrollTo(0, 0); }
    catch (err) { if (request === listRequest.current) setError(err instanceof Error ? err.message : String(err)); }
    finally { if (request === listRequest.current) setLoading(false); }
  }, [account, refresh, search]);
  useEffect(() => { configureTopBar({ search, searchPlaceholder: "Search mail", onSearchChange: setSearch, onSearch: () => void runSearch(), searchDisabled: false, sidebarCollapsed, onToggleSidebar: toggleSidebar, onSelectAccount: selectAccount }); }, [configureTopBar, runSearch, search, selectAccount, sidebarCollapsed, toggleSidebar]);

  const openDraft = (draft: FullMessage) => {
    setComposeMode("new"); setCompose(true); setComposeMinimized(false); setDraftId(draft.engineId); setDraftDirty(false); setDraftSaveBlocked(false); setDraftStatus("saved"); setLastSend(null); setSendError(null); setSendRequestId(null); setAttachments([]);
    setTo(draft.to?.map((item) => item.email).join(", ") ?? ""); setCc(draft.cc?.map((item) => item.email).join(", ") ?? ""); setBcc(""); setSubject(draft.subject); setHtml(normalizeComposeHtml(draft.htmlBody ?? plainTextToHtml(messageBody(draft)))); setInReplyTo(draft.headers?.["In-Reply-To"]); setReferences(draft.headers?.References);
  };
  const selectMessage = async (message: MessageSummary) => {
    if (!account) return;
    try { const full = await api.message(account.id, message.engineId); if (folder === "Drafts") { openDraft(full); return; } setOpen(full); setMobileView("reader"); if (!message.read) { const timer = window.setTimeout(() => { void api.read(account.id, message.engineId, true).then(() => { setMessages((prev) => prev.map((item) => item.engineId === message.engineId ? { ...item, read: true } : item)); setOpen((current) => current?.engineId === message.engineId ? { ...current, read: true } : current); void loadFolderCounts(account.id); }).catch((err) => setError(err instanceof Error ? err.message : String(err))); readTimers.current.delete(message.engineId); }, 400); readTimers.current.set(message.engineId, timer); } }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  };
  const toggleRead = async (message: MessageSummary | FullMessage) => { if (!account) return; const read = !message.read; const pending = readTimers.current.get(message.engineId); if (pending !== undefined) { window.clearTimeout(pending); readTimers.current.delete(message.engineId); } try { await api.read(account.id, message.engineId, read); setMessages((prev) => prev.map((item) => item.engineId === message.engineId ? { ...item, read } : item)); setOpen((current) => current?.engineId === message.engineId ? { ...current, read } : current); void loadFolderCounts(account.id); } catch (err) { setError(err instanceof Error ? err.message : String(err)); } };
  const toggleFlag = async (message: MessageSummary | FullMessage) => { if (!account) return; const flagged = !message.flagged; try { await api.flag(account.id, message.engineId, flagged); setMessages((prev) => prev.map((item) => item.engineId === message.engineId ? { ...item, flagged } : item)); setOpen((current) => current?.engineId === message.engineId ? { ...current, flagged } : current); } catch (err) { setError(err instanceof Error ? err.message : String(err)); } };
  const runAction = async (action: "archive" | "trash", engineId: string) => { if (!account) return; const message = messages.find((item) => item.engineId === engineId) ?? (open?.engineId === engineId ? open : undefined); try { await (action === "archive" ? api.archive(account.id, engineId) : api.trash(account.id, engineId)); setMessages((prev) => prev.filter((item) => item.engineId !== engineId)); adjustFolderCounts(folder, action === "archive" ? "Archive" : "Trash", message); setOpen(null); setMobileView("messages"); void loadFolderCounts(account.id); } catch (err) { setError(err instanceof Error ? err.message : String(err)); } };
  const restoreMessage = async (engineId: string) => { if (!account) return; const message = messages.find((item) => item.engineId === engineId) ?? (open?.engineId === engineId ? open : undefined); try { await api.move(account.id, engineId, "Inbox"); setMessages((prev) => prev.filter((item) => item.engineId !== engineId)); adjustFolderCounts(folder, "Inbox", message); setOpen(null); setMobileView("messages"); void loadFolderCounts(account.id); } catch (err) { setError(err instanceof Error ? err.message : String(err)); } };
  const destroyMessage = async (engineId: string) => { if (!account || !window.confirm("Permanently delete this message?\nThis cannot be undone.")) return; const message = messages.find((item) => item.engineId === engineId) ?? (open?.engineId === engineId ? open : undefined); try { await api.destroy(account.id, engineId); setMessages((prev) => prev.filter((item) => item.engineId !== engineId)); adjustFolderCounts(folder, undefined, message); setOpen(null); setMobileView("messages"); void loadFolderCounts(account.id); } catch (err) { setError(err instanceof Error ? err.message : String(err)); } };
  const emptyTrash = async () => { if (!account || !window.confirm("Permanently delete all messages in Trash?\nThis cannot be undone.")) return; try { await api.emptyTrash(account.id); setMessages([]); setFolderCounts((current) => ({ ...current, Trash: { total: 0, unread: 0 } })); setOpen(null); setSelectedIds(new Set()); void loadFolderCounts(account.id); } catch (err) { setError(err instanceof Error ? err.message : String(err)); } };

  const toggleSelected = (engineId: string) => setSelectedIds((current) => { const next = new Set(current); if (next.has(engineId)) next.delete(engineId); else next.add(engineId); return next; });
  const toggleSelectAll = () => setSelectedIds((current) => current.size === messages.length ? new Set() : new Set(messages.map((message) => message.engineId)));
  const runBulkAction = async (action: BulkMailAction) => {
    if (!account || selectedIds.size === 0) return;
    if (action === "destroy" && !window.confirm(`Permanently delete ${selectedIds.size} selected message${selectedIds.size === 1 ? "" : "s"}?\nThis cannot be undone.`)) return;
    const ids = [...selectedIds];
    try {
      await api.bulk(account.id, ids, action);
      if (["archive", "trash", "restore", "destroy"].includes(action)) setMessages((current) => current.filter((message) => !selectedIds.has(message.engineId)));
      else if (action === "read" || action === "unread") setMessages((current) => current.map((message) => selectedIds.has(message.engineId) ? { ...message, read: action === "read" } : message));
      else if (action === "star" || action === "unstar") setMessages((current) => current.map((message) => selectedIds.has(message.engineId) ? { ...message, flagged: action === "star" } : message));
      setSelectedIds(new Set()); setOpen(null); void loadFolderCounts(account.id);
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  };

  const openCompose = (mode: ComposeMode = "new", message?: FullMessage) => {
    setComposeMode(mode); setLastSend(null); setSendError(null); setSendRequestId(null); setCompose(true); setComposeMinimized(false); setDraftId(null); setDraftDirty(false); setDraftSaveBlocked(false); setDraftStatus("idle"); setAttachments([]);
    const currentAccount = account;
    if (!message) {
      const stored = mode === "new" && currentAccount ? localStorage.getItem(localDraftKey(currentAccount.id)) : null;
      if (stored) { try { const local = JSON.parse(stored) as { to?: string; cc?: string; bcc?: string; subject?: string; html?: string; text?: string; inReplyTo?: string; references?: string; mode?: ComposeMode }; setComposeMode(local.mode ?? "new"); setTo(local.to ?? ""); setCc(local.cc ?? ""); setBcc(local.bcc ?? ""); setSubject(local.subject ?? ""); setHtml(normalizeComposeHtml(local.html ?? plainTextToHtml(local.text ?? ""))); setInReplyTo(local.inReplyTo); setReferences(local.references); setDraftDirty(true); setDraftSaveBlocked(false); setDraftStatus("notSaved"); return; } catch { if (currentAccount) localStorage.removeItem(localDraftKey(currentAccount.id)); } }
      setTo(""); setCc(""); setBcc(""); setSubject(""); setHtml(`<div><br></div><div><br></div>${signatureFor("new")}`); setInReplyTo(undefined); setReferences(undefined); return;
    }
    const messageId = message.headers?.["Message-ID"]; const priorReferences = message.headers?.References?.trim(); setInReplyTo(mode === "forward" ? undefined : messageId); setReferences(mode === "forward" ? undefined : [priorReferences, messageId].filter(Boolean).join(" ") || undefined);
    if (mode === "forward") { setTo(""); setCc(""); setBcc(""); setSubject(subjectWithPrefix(message.subject || "(no subject)", "Fwd")); setHtml(`${signatureFor("forward")}<div>---------- Forwarded message ----------<br>From: ${message.from?.name || ""} &lt;${message.from?.email || ""}&gt;<br>Date: ${new Date(message.date).toLocaleString()}<br>Subject: ${message.subject || "(no subject)"}<br>To: ${message.to?.map((item) => item.email).join(", ") || ""}<br><br>${messageHtml(message)}</div>`); }
    else { const replyTo = uniqueRecipients([message.from?.email || "", ...(message.to ?? []).map((item) => item.email)], account?.address ?? ""); const replyCc = uniqueRecipients((message.cc ?? []).map((item) => item.email), account?.address ?? ""); const quote = `<div>On ${new Date(message.date).toLocaleString()}, ${message.from?.email || "the sender"} wrote:</div><blockquote>${messageHtml(message)}</blockquote>`; setTo((mode === "replyAll" ? replyTo : [message.from?.email || ""]).filter(Boolean).join(", ")); setCc(mode === "replyAll" ? replyCc.join(", ") : ""); setBcc(""); setSubject(subjectWithPrefix(message.subject || "(no subject)", "Re")); setHtml(signature?.position === "afterQuotedText" ? `${quote}${signatureFor(mode)}` : `${signatureFor(mode)}${quote}`); }
  };
  const openComposeTo = (email: string) => { openCompose("new"); setTo(email); };

  const draftPayload = useCallback((): import("../api").DraftInput | null => {
    if (!account) return null;
    const cleanHtml = normalizeComposeHtml(html);
    return { accountId: account.id, to: draftRecipients(to), cc: draftRecipients(cc), bcc: draftRecipients(bcc), subject, textBody: richTextToText(cleanHtml), htmlBody: cleanHtml, inReplyTo, references, mode: composeMode, templateKey };
  }, [account, bcc, cc, composeMode, html, inReplyTo, references, subject, templateKey, to]);
  const saveDraft = useCallback(async (force = false): Promise<string | null> => { if (!account || !compose || (!draftDirty && !force)) return draftId; const payload = draftPayload(); if (!payload) return draftId; setDraftStatus("saving"); try { const savedId = draftId ? (await api.updateDraft(draftId, payload)).engineId : (await api.createDraft(payload)).engineId; localStorage.removeItem(localDraftKey(account.id)); setDraftId(savedId); setDraftDirty(false); setDraftSaveBlocked(false); setDraftStatus("saved"); return savedId; } catch { localStorage.setItem(localDraftKey(account.id), JSON.stringify({ mode: composeMode, to, cc, bcc, subject, html: normalizeComposeHtml(html), inReplyTo, references })); setDraftSaveBlocked(true); setDraftStatus("notSaved"); return null; } }, [account, bcc, cc, compose, composeMode, draftDirty, draftId, draftPayload, html, inReplyTo, references, subject, to]);
  useEffect(() => { if (!compose || !draftDirty || draftSaveBlocked) return; const timer = window.setTimeout(() => { void saveDraft(); }, 1500); return () => window.clearTimeout(timer); }, [compose, draftDirty, draftSaveBlocked, to, cc, bcc, subject, html, saveDraft]);
  useEffect(() => { const saveOnHide = () => { if (document.visibilityState === "hidden") void saveDraft(); }; document.addEventListener("visibilitychange", saveOnHide); return () => document.removeEventListener("visibilitychange", saveOnHide); }, [saveDraft]);
  const runSend = async () => { if (!account) return; try { setError(null); setSendError(null); setSending(true); const clientRequestId = sendRequestId ?? crypto.randomUUID(); setSendRequestId(clientRequestId); const cleanHtml = normalizeComposeHtml(html); const savedId = await saveDraft(true); const result = savedId ? await api.sendDraft(savedId, account.id, clientRequestId, composeMode, templateKey, attachments) : await api.send(account.id, parseRecipients(to), { cc: parseRecipients(cc), bcc: parseRecipients(bcc), subject, textBody: richTextToText(cleanHtml), htmlBody: cleanHtml, inReplyTo, references, mode: composeMode, clientRequestId, templateKey, attachments }); setLastSend(result); setSendError(null); setCompose(false); setComposeMinimized(false); setDraftId(null); setDraftDirty(false); setDraftSaveBlocked(false); setSendRequestId(null); localStorage.removeItem(localDraftKey(account.id)); setTo(""); setCc(""); setBcc(""); setSubject(""); setHtml(""); setAttachments([]); setInReplyTo(undefined); setReferences(undefined); } catch (err) { const message = err instanceof Error ? err.message : String(err); setSendError(message); setError(message); } finally { setSending(false); } };
  const runUndo = async () => { if (!lastSend) return; try { const result = await api.cancelSend(lastSend.sendId); setLastSend({ ...lastSend, status: result.status }); } catch (err) { setError(err instanceof Error ? err.message : String(err)); } };

  return <>
    <main className={`gsw-mail-body ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      {foldersOpen && <button className="gsw-folder-backdrop" aria-label="Close folders" onClick={() => setFoldersOpen(false)} />}
      <MailSidebar account={account} profileImageUrl={profileImageUrl} folder={folder} counts={folderCounts} composeOpen={compose} mobileHidden={!foldersOpen} collapsed={sidebarCollapsed} onSelectFolder={selectFolder} onToggleCompose={() => { setFoldersOpen(false); if (compose) { void saveDraft(true); setCompose(false); } else openCompose(); }} />
      <section className={`gsw-message-list ${mobileView !== "messages" ? "" : "mobile-open"}`} aria-label={`${folder} messages`}>
        <MessageListHeader folder={folder} count={searchResults ? messages.length : folderCounts[folder].total} selectedCount={selectedIds.size} allSelected={messages.length > 0 && selectedIds.size === messages.length} onToggleSelectAll={toggleSelectAll} onClearSelection={() => setSelectedIds(new Set())} onBulkAction={(action) => void runBulkAction(action)} onRefresh={refresh} onEmptyTrash={folder === "Trash" ? () => void emptyTrash() : undefined} />
        {error && <p className="gsw-errors">{error}</p>}
        <div className="gsw-message-list-scroll" ref={listScroll} aria-busy={loading}>{messages.length ? messages.map((message) => <MessageRow key={message.engineId} message={message} folder={folder} active={open?.engineId === message.engineId} selected={selectedIds.has(message.engineId)} onSelect={() => toggleSelected(message.engineId)} onOpen={() => void selectMessage(message)} onToggleRead={() => void toggleRead(message)} onToggleFlag={() => void toggleFlag(message)} onDelete={() => void runAction("trash", message.engineId)} onArchive={() => void runAction("archive", message.engineId)} onRestore={folder === "Trash" ? () => void restoreMessage(message.engineId) : undefined} onDestroy={folder === "Trash" ? () => void destroyMessage(message.engineId) : undefined} />) : <div className="gsw-list-empty"><span aria-hidden="true"><Inbox size={28} strokeWidth={1.75} /></span><strong>No messages here</strong><p>Your {folder.toLowerCase()} is clear.</p></div>}</div>
        <nav className="gsw-message-pagination" aria-label="Message pages"><button className="gsw-icon-btn" aria-label="Previous page" disabled={loading || page === 0} onClick={() => account && void loadFolder(account.id, folder, page - 1)}>‹</button><span aria-live="polite">{loading ? "Loading…" : `${messages.length ? page * pageSize + 1 : 0}–${page * pageSize + messages.length}${searchResults ? " results" : ` of ${folderCounts[folder].total}`}`}</span><button className="gsw-icon-btn" aria-label="Next page" disabled={loading || searchResults || (page + 1) * pageSize >= folderCounts[folder].total} onClick={() => account && void loadFolder(account.id, folder, page + 1)}>›</button></nav>
      </section>
      <section className={`gsw-reading-pane ${mobileView === "reader" ? "mobile-open" : ""} ${sidebarCollapsed ? "sidebar-collapsed" : ""}`} aria-label="Message reader">{open ? <MessageReader message={open} accountId={account?.id} accountAddress={account?.address} folder={folder} onBack={() => setMobileView("messages")} onReply={() => openCompose("reply", open)} onReplyAll={() => openCompose("replyAll", open)} onForward={() => openCompose("forward", open)} onArchive={() => void runAction("archive", open.engineId)} onTrash={() => void runAction("trash", open.engineId)} onToggleRead={() => void toggleRead(open)} onRestore={() => void restoreMessage(open.engineId)} onDestroy={() => void destroyMessage(open.engineId)} onComposeEmail={openComposeTo} /> : <EmptyReader />}</section>
    </main>
    {compose && <ComposeWindow mode={composeMode} minimized={composeMinimized} to={to} cc={cc} bcc={bcc} subject={subject} html={html} attachments={attachments} sending={sending} draftStatus={draftStatus} sendError={sendError} sendNote={lastSend ? `Sent · ${lastSend.status}` : undefined} onToChange={(value) => { setTo(value); setDraftDirty(true); setDraftSaveBlocked(false); setSendRequestId(null); }} onCcChange={(value) => { setCc(value); setDraftDirty(true); setDraftSaveBlocked(false); setSendRequestId(null); }} onBccChange={(value) => { setBcc(value); setDraftDirty(true); setDraftSaveBlocked(false); setSendRequestId(null); }} onSubjectChange={(value) => { setSubject(value); setDraftDirty(true); setDraftSaveBlocked(false); setSendRequestId(null); }} onHtmlChange={(value) => { setHtml(value); setDraftDirty(true); setDraftSaveBlocked(false); setSendRequestId(null); }} onAttachmentsChange={(value) => { setAttachments(value); setSendRequestId(null); }} onMinimize={() => { void saveDraft(true); setComposeMinimized((current) => !current); }} onClose={() => { void saveDraft(true); setCompose(false); }} onSubmit={() => void runSend()} onRetry={() => void runSend()} onUndo={lastSend ? () => void runUndo() : undefined} />}
  </>;
}
