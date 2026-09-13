import type { Account } from "../api";
import { FOLDERS, FOLDER_ICON, type Folder } from "./folders";

const sx: { [k: string]: React.CSSProperties } = {
  sidebar: { width: 260, borderRight: "1px solid #eee", padding: 16, flexShrink: 0 },
  brand: { margin: "0 0 4px" },
  brandLogo: { width: 28, height: 28, display: "block" },
  select: { display: "block", width: "100%", margin: "0 0 16px", padding: 6 },
  folder: {
    display: "block",
    width: "100%",
    textAlign: "left",
    padding: "8px 10px",
    border: 0,
    background: "transparent",
    cursor: "pointer",
    borderRadius: 6,
  },
  folderActive: { background: "#e8f0fe", fontWeight: 600 },
  composeButton: { width: "100%", marginTop: 8, padding: 8, cursor: "pointer" },
};

export function Sidebar({
  accountId,
  accounts,
  folder,
  onSelectAccount,
  onSelectFolder,
  onToggleCompose,
  composeOpen,
}: {
  accountId: string;
  accounts: Account[];
  folder: Folder;
  onSelectAccount: (id: string) => void;
  onSelectFolder: (name: Folder) => void;
  onToggleCompose: () => void;
  composeOpen: boolean;
}) {
  return (
    <aside style={sx.sidebar}>
      <h1 style={sx.brand}>
        <img src="/logo.png" alt="Guided Steps Mail" style={sx.brandLogo} />
      </h1>
      <select
        value={accountId}
        onChange={(e) => onSelectAccount(e.target.value)}
        style={sx.select}
        aria-label="Account"
      >
        {accounts.length === 0 && <option value="">no account</option>}
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.address} · {a.role}
          </option>
        ))}
      </select>
      <nav>
        {FOLDERS.map((name) => (
          <button
            key={name}
            onClick={() => onSelectFolder(name)}
            style={{ ...sx.folder, ...(folder === name ? sx.folderActive : {}) }}
          >
            <span aria-hidden="true">{FOLDER_ICON[name]}</span> {name}
          </button>
        ))}
      </nav>
      <button style={sx.composeButton} onClick={onToggleCompose}>
        {composeOpen ? "Close" : "+ Compose"}
      </button>
    </aside>
  );
}
