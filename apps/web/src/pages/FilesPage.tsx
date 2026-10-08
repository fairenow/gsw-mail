import { useEffect, useMemo, useRef, useState } from "react";
import { Download, File, FileImage, FileSpreadsheet, FileText, Folder, FolderPlus, MoreHorizontal, RefreshCw, RotateCcw, Star, Trash2, Upload } from "lucide-react";
import { api, type FileNode, type StorageUsage } from "../api";
import { MailWorkspace } from "../components/MailWorkspace";
import { useAppShell } from "../components/AppShell";

type FilesView = "folder" | "recent" | "starred" | "trash";

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

export function FilesPage() {
  const { configureTopBar } = useAppShell();
  const [view, setView] = useState<FilesView>("folder");
  const [files, setFiles] = useState<FileNode[]>([]);
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const [path, setPath] = useState<Array<{ id: string | null; name: string }>>([{ id: null, name: "My Files" }]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [menuId, setMenuId] = useState<string | null>(null);
  const [allFolders, setAllFolders] = useState<FileNode[]>([]);
  const uploadInput = useRef<HTMLInputElement>(null);

  const parentId = view === "folder" ? path[path.length - 1]?.id ?? null : null;

  const load = async () => {
    setLoading(true);
    setNotice("");
    try {
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
    configureTopBar({
      search: "",
      searchPlaceholder: "Search files",
      onSearchChange: () => undefined,
      onSearch: () => undefined,
      searchDisabled: true,
    });
  }, [configureTopBar]);

  const usagePercent = useMemo(() => usage && usage.quotaBytes > 0 ? Math.min(100, (usage.usedBytes / usage.quotaBytes) * 100) : 0, [usage]);

  const openFolder = (item: FileNode) => {
    setPath((current) => [...current, { id: item.id, name: item.name }]);
    setView("folder");
  };

  const createFolder = async () => {
    const name = window.prompt("Folder name");
    if (!name?.trim()) return;
    setBusy(true);
    try {
      await api.createFileFolder(name.trim(), parentId);
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

  return <MailWorkspace section="files">
    <main className="gsw-files-page">
      <div className="gsw-page-heading gsw-files-heading">
        <div>
          <p className="gsw-eyebrow">Workspace</p>
          <h1>Files</h1>
          <p>Store, organize, and reuse files across Mail, Templates, and GSW Chat.</p>
        </div>
        <div className="gsw-files-actions">
          <input ref={uploadInput} className="gsw-hidden-input" type="file" multiple onChange={(event) => void uploadFiles(event.target.files)} />
          {view === "folder" && <><button className="gsw-secondary-btn" disabled={busy} onClick={() => void createFolder()}><FolderPlus size={16} /> New folder</button><button className="gsw-primary-btn" disabled={busy} onClick={() => uploadInput.current?.click()}><Upload size={16} /> {busy ? "Working…" : "Upload"}</button></>}
          <button className="gsw-icon-btn" title="Refresh files" aria-label="Refresh files" onClick={() => void load()}><RefreshCw size={17} /></button>
        </div>
      </div>

      <div className="gsw-files-layout">
        <aside className="gsw-files-subnav">
          <button className={view === "folder" ? "active" : ""} onClick={() => { setView("folder"); setPath([{ id: null, name: "My Files" }]); }}>My Files</button>
          <button className={view === "recent" ? "active" : ""} onClick={() => setView("recent")}>Recent</button>
          <button className={view === "starred" ? "active" : ""} onClick={() => setView("starred")}>Starred</button>
          <button className={view === "trash" ? "active" : ""} onClick={() => setView("trash")}>Trash</button>
          {usage && <div className="gsw-storage-card"><strong>{formatBytes(usage.usedBytes)} of {formatBytes(usage.quotaBytes)}</strong><div><span style={{ width: `${usagePercent}%` }} /></div><small>{usage.planKey === "free" ? "Free plan" : usage.planKey} storage</small></div>}
        </aside>

        <section className="gsw-files-browser">
          {view === "folder" && <div className="gsw-files-breadcrumb">{path.map((part, index) => <button key={part.id ?? "root"} onClick={() => setPath((current) => current.slice(0, index + 1))}>{part.name}</button>)}</div>}
          {notice && <p className="gsw-files-notice">{notice}</p>}
          {loading ? <div className="gsw-empty-product">Loading files…</div> : files.length === 0 ? <div className="gsw-empty-product"><strong>{view === "trash" ? "Trash is empty" : view === "starred" ? "No starred files" : view === "recent" ? "No recent files" : "This folder is empty"}</strong><p>{view === "folder" ? "Upload a file or create a folder to get started." : "Files will appear here as you use GSW."}</p></div> :
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
                    <button onClick={() => void rename(item)}>Rename</button>
                    <button onClick={() => void move(item)}>Move</button>
                    <button className="danger" onClick={() => void trash(item)}><Trash2 size={15} /> Move to Trash</button>
                  </div>}
                </div>}
            </div>)}</div>}
        </section>
      </div>
    </main>
  </MailWorkspace>;
}
