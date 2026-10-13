import { useEffect, useMemo, useRef, useState } from "react";
import { Download, File, FileImage, FileSpreadsheet, FileText, Folder, FolderPlus, MoreHorizontal, Share2, Link2, RefreshCw, RotateCcw, Star, Trash2, Upload } from "lucide-react";
import { api, type FileNode, type StorageUsage } from "../api";
import { MailWorkspace } from "../components/MailWorkspace";
import { useAppShell } from "../components/AppShell";

type FilesView = "folder" | "recent" | "starred" | "trash" | "shared";

const formatBytes = (size: number) => {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 10 * 1024 ? 1 : 0)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(size < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`;
};

const iconFor = (item: FileNode) => {
  if (item.nodeType === "folder") return <Folder size={22} strokeWidth={1.65} />;
  if (item.kind === "image") return <FileImage size={22} strokeWidth={1.65} />;
  if (item.kind === "spreadsheet") return <FileSpreadsheet size={22} strokeWidth={1.65} />;
  if (item.kind === "pdf" || item.kind === "document" || item.kind === "presentation") return <FileText size={22} strokeWidth={1.65} />;
  return <File size={22} strokeWidth={1.65} />;
};

export function FilesPage({ embedded = false }: { embedded?: boolean } = {}) {
  const { configureTopBar } = useAppShell();
  const [view, setView] = useState<FilesView>("folder");
  const [files, setFiles] = useState<FileNode[]>([]);
  const [sharedFiles, setSharedFiles] = useState<Array<{ shareId: string; filename: string; mimeType: string; sizeBytes: number }>>([]);
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const [path, setPath] = useState<Array<{ id: string | null; name: string }>>([{ id: null, name: "My Files" }]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [menuId, setMenuId] = useState<string | null>(null);
  const [shareItem, setShareItem] = useState<FileNode | null>(null);
  const [shareEmail, setShareEmail] = useState("");
  const [shareGrants, setShareGrants] = useState<Array<{ id: string; scope: "anyone" | "email"; recipientEmail: string | null; revokedAt: string | null }>>([]);
  const [shareLink, setShareLink] = useState("");
  const [shareBusy, setShareBusy] = useState(false);
  const [shareNotice, setShareNotice] = useState("");

  const [allFolders, setAllFolders] = useState<FileNode[]>([]);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const uploadInput = useRef<HTMLInputElement>(null);
  const newFolderInputRef = useRef<HTMLInputElement>(null);

  const parentId = view === "folder" ? path[path.length - 1]?.id ?? null : null;

  const load = async () => {
    setLoading(true);
    setNotice("");
    try {
      if (view === "shared") {
        const [shared, quota] = await Promise.all([api.sharedWithMe(), api.fileUsage()]);
        setSharedFiles(shared.files); setFiles([]); setUsage(quota);
        return;
      }
      const [rows, quota, recent] = await Promise.all([
        api.files(parentId, view),
        api.fileUsage(),
        api.files(null, "recent"),
      ]);
      setFiles(rows);
      setUsage(quota);
      setAllFolders(recent.filter((item) => item.nodeType === "folder" && !item.trashedAt));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [view, parentId]);
  useEffect(() => {
    if (embedded) return;
    configureTopBar({
      search: "",
      searchPlaceholder: "Search files",
      onSearchChange: () => undefined,
      onSearch: () => undefined,
      searchDisabled: true,
    });
  }, [configureTopBar, embedded]);

  useEffect(() => {
    if (!newFolderOpen) return;
    window.requestAnimationFrame(() => newFolderInputRef.current?.focus());
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setNewFolderOpen(false);
        setNewFolderName("");
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [newFolderOpen]);

  const usagePercent = useMemo(() => usage && usage.quotaBytes > 0 ? Math.min(100, (usage.usedBytes / usage.quotaBytes) * 100) : 0, [usage]);

  const openFolder = (item: FileNode) => {
    setPath((current) => [...current, { id: item.id, name: item.name }]);
    setView("folder");
  };

  const createFolder = async () => {
    const name = newFolderName.trim();
    if (!name) return;
    setBusy(true);
    try {
      await api.createFileFolder(name, parentId);
      setNewFolderOpen(false);
      setNewFolderName("");
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const uploadFiles = async (list: FileList | null) => {
    if (!list?.length) return;
    setBusy(true);
    setNotice("");
    try {
      for (const file of Array.from(list)) {
        await api.uploadFile(file, { source: "files", parentId });
      }
      setNotice(`${list.length} file${list.length === 1 ? "" : "s"} uploaded`);
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      if (uploadInput.current) uploadInput.current.value = "";
      setBusy(false);
    }
  };

  const loadGrants = async (assetId: string) => {
    const result = await api.fileShares(assetId);
    setShareGrants(result.grants);
  };
  const openShare = async (item: FileNode) => {
    if (!item.assetId) return;
    setMenuId(null);
    setShareItem(item);
    setShareLink("");
    setShareEmail("");
    setShareNotice("");
    try { await loadGrants(item.assetId); }
    catch (error) { setShareNotice(error instanceof Error ? error.message : "Unable to load sharing permissions."); }
  };
  const createLink = async () => {
    if (!shareItem?.assetId) return;
    setShareBusy(true); setShareNotice("");
    try {
      const result = await api.createFileShare(shareItem.assetId, { scope: "anyone" });
      if (!result.path) throw new Error("No share URL was returned");
      setShareLink(new URL(result.path, window.location.origin).toString());
      await loadGrants(shareItem.assetId);
      setShareNotice("Anyone with this link can view or download this file until you revoke access.");
    } catch (error) { setShareNotice(error instanceof Error ? error.message : "Could not create share link."); }
    finally { setShareBusy(false); }
  };
  const inviteEmail = async () => {
    if (!shareItem?.assetId || !shareEmail.trim()) return;
    setShareBusy(true); setShareNotice("");
    try {
      await api.createFileShare(shareItem.assetId, { scope: "email", email: shareEmail.trim().toLowerCase() });
      await loadGrants(shareItem.assetId);
      setShareEmail("");
      setShareNotice("Access granted. This person can open the file after signing in with the verified matching email. An invitation email is not sent yet.");
    } catch (error) { setShareNotice(error instanceof Error ? error.message : "Could not grant access."); }
    finally { setShareBusy(false); }
  };
  const revokeShare = async (shareId: string) => {
    if (!shareItem?.assetId) return;
    setShareBusy(true);
    try { await api.revokeFileShare(shareItem.assetId, shareId); await loadGrants(shareItem.assetId); setShareLink(""); setShareNotice("Access revoked. Already-issued temporary download links may remain valid for up to one minute."); }
    catch (error) { setShareNotice(error instanceof Error ? error.message : "Could not revoke sharing."); }
    finally { setShareBusy(false); }
  };

  const download = async (item: FileNode) => {
    if (!item.assetId) return;
    try {
      const result = await api.fileDownload(item.assetId);
      window.open(result.url, "_blank", "noopener,noreferrer");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  };

  const rename = async (item: FileNode) => {
    const name = window.prompt("Rename", item.name);
    if (!name?.trim() || name.trim() === item.name) return;
    await api.updateFileNode(item.id, { name: name.trim() });
    setMenuId(null);
    await load();
  };

  const move = async (item: FileNode) => {
    const choices = [{ id: "", name: "My Files" }, ...allFolders.filter((folder) => folder.id !== item.id).map((folder) => ({ id: folder.id, name: folder.name }))];
    const answer = window.prompt(`Move “${item.name}” to:\n${choices.map((choice, index) => `${index + 1}. ${choice.name}`).join("\n")}\n\nEnter a number:`);
    const index = Number(answer) - 1;
    if (!Number.isInteger(index) || index < 0 || index >= choices.length) return;
    await api.updateFileNode(item.id, { parentId: choices[index]!.id || null });
    setMenuId(null);
    await load();
  };

  const toggleStar = async (item: FileNode) => {
    await api.updateFileNode(item.id, { starred: !item.starred });
    setMenuId(null);
    await load();
  };

  const trash = async (item: FileNode) => {
    await api.trashFileNode(item.id);
    setMenuId(null);
    await load();
  };

  const restore = async (item: FileNode) => {
    await api.restoreFileNode(item.id);
    setMenuId(null);
    await load();
  };

  const permanentlyDelete = async (item: FileNode) => {
    if (!window.confirm(`Permanently delete “${item.name}”? This cannot be undone.`)) return;
    try {
      await api.deleteFileNode(item.id);
      setMenuId(null);
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  };

  const content = <main className={`gsw-files-page ${embedded ? "gsw-files-page-embedded" : ""}`}>
      <div className="gsw-page-heading gsw-files-heading">
        <div>
          <p className="gsw-eyebrow">Workspace</p>
          <h1>Files</h1>
          <p>Store, organize, and reuse files across Mail, Templates, and GSW Chat.</p>
        </div>
        <div className="gsw-files-actions">
          <input ref={uploadInput} className="gsw-hidden-input" type="file" multiple onChange={(event) => void uploadFiles(event.target.files)} />
          {view === "folder" && <>
            <div className="gsw-new-folder-wrap">
              <button className="gsw-secondary-btn" disabled={busy} onClick={() => setNewFolderOpen((current) => !current)} aria-expanded={newFolderOpen}>
                <FolderPlus size={16} /> New folder
              </button>
              {newFolderOpen && <form className="gsw-new-folder-popover" onSubmit={(event) => { event.preventDefault(); void createFolder(); }}>
                <label htmlFor="gsw-new-folder-name">New folder</label>
                <input
                  id="gsw-new-folder-name"
                  ref={newFolderInputRef}
                  value={newFolderName}
                  onChange={(event) => setNewFolderName(event.target.value)}
                  placeholder="Folder name"
                  maxLength={255}
                />
                <div>
                  <button type="button" className="gsw-text-btn" onClick={() => { setNewFolderOpen(false); setNewFolderName(""); }}>Cancel</button>
                  <button type="submit" className="gsw-primary-btn" disabled={busy || !newFolderName.trim()}>Create</button>
                </div>
              </form>}
            </div>
            <button className="gsw-primary-btn" disabled={busy} onClick={() => uploadInput.current?.click()}><Upload size={16} /> {busy ? "Working…" : "Upload"}</button>
          </>}
          <button className="gsw-icon-btn" title="Refresh files" aria-label="Refresh files" onClick={() => void load()}><RefreshCw size={17} /></button>
        </div>
      </div>

      <div className="gsw-files-layout">
        <aside className="gsw-files-subnav">
          <button className={view === "folder" ? "active" : ""} onClick={() => { setView("folder"); setPath([{ id: null, name: "My Files" }]); }}>My Files</button>
          <button className={view === "recent" ? "active" : ""} onClick={() => setView("recent")}>Recent</button>
          <button className={view === "starred" ? "active" : ""} onClick={() => setView("starred")}>Starred</button>
          <button className={view === "trash" ? "active" : ""} onClick={() => setView("trash")}>Trash</button>
          <button className={view === "shared" ? "active" : ""} onClick={() => setView("shared")}>Shared with me</button>
          {usage && <div className="gsw-storage-card"><strong>{formatBytes(usage.usedBytes)} of {formatBytes(usage.quotaBytes)}</strong><div><span style={{ width: `${usagePercent}%` }} /></div><small>{usage.planKey === "free" ? "Free plan" : usage.planKey} storage</small></div>}
        </aside>

        <section className="gsw-files-browser">
          {view === "folder" && <div className="gsw-files-breadcrumb">{path.map((part, index) => <button key={part.id ?? "root"} onClick={() => setPath((current) => current.slice(0, index + 1))}>{part.name}</button>)}</div>}
          {notice && <p className="gsw-files-notice">{notice}</p>}
          {view === "shared" ? (loading ? <div className="gsw-empty-product">Loading shared files…</div> : sharedFiles.length === 0 ? <div className="gsw-empty-product"><strong>No files shared with you</strong><p>Files shared with your verified GSW email address will appear here.</p></div> : <div className="gsw-files-list">{sharedFiles.map(file => <div className="gsw-file-row" key={file.shareId}>
            <div className="gsw-file-main"><span className="gsw-file-icon"><FileText size={21}/></span><span><strong>{file.filename}</strong><small>Shared · Viewer · {formatBytes(file.sizeBytes)}</small></span></div>
            <button className="gsw-secondary-btn" onClick={() => window.open(`/product/files/shares/${encodeURIComponent(file.shareId)}/download`, "_blank", "noopener,noreferrer")}><Download size={16}/> Download</button>
          </div>)}</div>) :
                    (loading ? <div className="gsw-empty-product">Loading files…</div> : files.length === 0 ? <div className="gsw-empty-product"><strong>{view === "trash" ? "Trash is empty" : view === "starred" ? "No starred files" : view === "recent" ? "No recent files" : "This folder is empty"}</strong><p>{view === "folder" ? "Upload a file or create a folder to get started." : "Files will appear here as you use GSW."}</p></div> :
            <div className="gsw-files-list">{files.map((item) => <div className="gsw-file-row" key={item.id}>
              <button className="gsw-file-main" onDoubleClick={() => item.nodeType === "folder" && openFolder(item)} onClick={() => item.nodeType === "folder" && openFolder(item)}>
                <span className="gsw-file-icon">{iconFor(item)}</span>
                <span><strong>{item.name}</strong><small>{item.nodeType === "folder" ? "Folder" : `${item.kind || "File"} · ${formatBytes(Number(item.sizeBytes ?? 0))}`}</small></span>
              </button>
              <span className="gsw-file-updated">{new Date(item.updatedAt).toLocaleDateString()}</span>
              {item.starred && <Star size={15} fill="currentColor" aria-label="Starred" />}
              {view === "trash" ? <div className="gsw-file-quick-actions"><button className="gsw-icon-btn" title="Restore" onClick={() => void restore(item)}><RotateCcw size={16} /></button><button className="gsw-icon-btn" title="Delete permanently" onClick={() => void permanentlyDelete(item)}><Trash2 size={16} /></button></div> :
                <div className="gsw-file-menu-wrap">
                  {item.assetId && <button className="gsw-icon-btn" title="Download" onClick={() => void download(item)}><Download size={16} /></button>}
                  <button className="gsw-icon-btn" aria-label={`More actions for ${item.name}`} onClick={() => setMenuId((current) => current === item.id ? null : item.id)}><MoreHorizontal size={17} /></button>
                  {menuId === item.id && <div className="gsw-file-menu">
                    <button onClick={() => void toggleStar(item)}><Star size={15} /> {item.starred ? "Unstar" : "Star"}</button>
                    {item.assetId && <button onClick={() => void openShare(item)}><Share2 size={15}/> Share</button>}
                    <button onClick={() => void rename(item)}>Rename</button>
                    <button onClick={() => void move(item)}>Move</button>
                    <button className="danger" onClick={() => void trash(item)}><Trash2 size={15} /> Move to Trash</button>
                  </div>}
                </div>}
            </div>)}</div>)}
        </section>
      </div>
      {shareItem && <div role="presentation" style={{ position: "fixed", inset: 0, zIndex: 2000, background: "rgba(0,0,0,.45)", display: "grid", placeItems: "center", padding: 16 }} onClick={() => setShareItem(null)}>
        <section role="dialog" aria-modal="true" aria-label={`Share ${shareItem.name}`} onClick={event => event.stopPropagation()} style={{ width: "min(100%, 530px)", background: "#fff", borderRadius: 22, padding: 24, display: "grid", gap: 18, boxShadow: "0 24px 70px rgba(0,0,0,.22)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}><div><h2 style={{ margin: 0 }}>Share file</h2><p style={{ margin: "6px 0 0", color: "#706c65", overflowWrap: "anywhere" }}>{shareItem.name}</p></div><button className="gsw-secondary-btn" onClick={() => setShareItem(null)}>Close</button></div>
          <div style={{ display: "grid", gap: 8 }}>
            <strong>Grant access by email</strong><p style={{ margin: 0, fontSize: 12, color: "#777" }}>Viewer access only. Recipient must have a verified GSW account.</p>
            <form style={{ display: "flex", gap: 8 }} onSubmit={event => { event.preventDefault(); void inviteEmail(); }}>
              <input type="email" required placeholder="person@example.com" aria-label="Recipient email" value={shareEmail} onChange={event => setShareEmail(event.target.value)} style={{ minWidth: 0, flex: 1, borderRadius: 9, border: "1px solid #ddd", padding: 10 }}/>
              <button className="gsw-primary-btn" type="submit" disabled={shareBusy}>Grant access</button>
            </form>
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            <strong>General access</strong><p style={{ margin: 0, fontSize: 12, color: "#777" }}>Restricted by default. Public links grant view/download access only.</p>
            {shareLink ? <div style={{ display: "flex", gap: 8 }}><input readOnly value={shareLink} aria-label="Share link" style={{ flex: 1, minWidth: 0, border: "1px solid #ddd", padding: 8, borderRadius: 8 }}/><button className="gsw-secondary-btn" onClick={() => void navigator.clipboard.writeText(shareLink)}>Copy link</button></div> : <button className="gsw-secondary-btn" type="button" disabled={shareBusy} onClick={() => void createLink()}><Link2 size={16}/> Create anyone-with-link access</button>}
          </div>
          <div style={{ display: "grid", gap: 7 }}><strong>People and links with access</strong>
            {shareGrants.filter(grant => !grant.revokedAt).length === 0 ? <p style={{ color: "#777", margin: 0 }}>Only you have access.</p> : shareGrants.filter(grant => !grant.revokedAt).map(grant =>
              <div key={grant.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid #eee" }}>
                <span style={{ flex: 1, overflowWrap: "anywhere" }}>{grant.scope === "anyone" ? "Anyone with the link · Viewer" : `${grant.recipientEmail} · Viewer`}</span>
                <button className="gsw-text-btn" disabled={shareBusy} onClick={() => void revokeShare(grant.id)}>Revoke</button>
              </div>)}
          </div>
          {shareNotice && <p role="status" style={{ fontSize: 13, margin: 0, color: "#5e5140" }}>{shareNotice}</p>}
        </section>
      </div>}
    </main>;

  return embedded
    ? <div className="gsw-embedded-workspace gsw-embedded-files">{content}</div>
    : <MailWorkspace section="files">{content}</MailWorkspace>;
}
