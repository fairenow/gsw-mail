import { FOLDERS, FOLDER_ICON, type Folder } from "./folders";
import type { Account } from "../api";

export function Sidebar({
  accounts,
  accountId,
  folder,
  onSelectAccount,
  onSelectFolder,
  onToggleCompose,
  composeOpen,
}: {
  accounts: Account[];
  accountId: string;
  folder: Folder;
  onSelectAccount: (id: string) => void;
  onSelectFolder: (name: Folder) => void;
  onToggleCompose: () => void;
  composeOpen: boolean;
}) {
  return (
    <aside style={sx.sidebar}>
      <h1 style={sx.brand}>Guided Steps Mail</h1>
      <select
        value={accountId}
        onChange={(e) => onSelectAccount(e.target.value)}
        style={sx.select}
        aria-label="Account"
      >
        <option value="">Select account</option>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.address}
          </option>
        ))}
      </select>
      <nav style={sx.nav} aria-label="Folders">
        {FOLDERS.map((name) => (
          <button
            key={name}
            onClick={() => onSelectFolder(name)}
            style={{ ...sx.folder, ...(folder === name ? sx.folderActive : {}) }}
          >
            <span aria-hidden="true" style={sx.icon}>{FOLDER_ICON[name]}</span> {name}
          </button>
        ))}
      </nav>
      <button style={sx.composeButton} onClick={onToggleCompose}>
        {composeOpen ? "Close" : "+ Compose"}
      </button>
    </aside>
  );
}

const sx: Record<string, React.CSSProperties> = {
  sidebar: { width: 240, borderRight: "1px solid #eee", padding: 16, flexShrink: 0 },
  brand: { fontSize: 17, margin: "0 0 12px" },
  select: { display: "block", width: "100%", marginBottom: 16, padding: 6 },
  nav: { display: "flex", flexDirection: "column", gap: 2 },
  folder: { display: "flex", gap: 8, alignItems: "center", padding: "8px 10px", border: 0, background: "transparent", borderRadius: 6, cursor: "pointer" },
  folderActive: { background: "#e8f0fe", fontWeight: 600 },
  icon: { width: 16, textAlign: "center" },
  composeButton: { width: "100%", marginTop: 8, padding: 8, cursor: "pointer" },
};
