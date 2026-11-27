import { useRef, useState } from "react";

const MCP_URL = "https://api.guidedstepswellness.com/mcp";
const MCP_ICON = "/gsw-mail-mcp-icon.png";

export function McpSettings({ onManageConnections }: { onManageConnections: () => void }) {
  const urlInput = useRef<HTMLInputElement>(null);
  const [notice, setNotice] = useState("");

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(MCP_URL);
      setNotice("MCP link copied.");
    } catch {
      urlInput.current?.focus();
      urlInput.current?.select();
      setNotice("Link selected. Copy it using your device's copy shortcut.");
    }
  };

  return <div className="gsw-settings-card">
    <div className="gsw-settings-card-head">
      <div>
        <h2>Connect GSW Mail to your AI</h2>
        <p>Use GSW Mail in your preferred AI assistant through Model Context Protocol (MCP).</p>
      </div>
      <img src={MCP_ICON} width={64} height={64} alt="GSW Mail icon" style={{ objectFit: "contain", flexShrink: 0 }} />
    </div>
    <label htmlFor="gsw-mcp-server-url">MCP server URL</label>
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
      <input id="gsw-mcp-server-url" ref={urlInput} value={MCP_URL} readOnly onFocus={event => event.currentTarget.select()} style={{ flex: "1 1 240px", minWidth: 0 }} />
      <button type="button" className="gsw-secondary-btn" onClick={() => void copyUrl()}>Copy link</button>
    </div>
    <div role="status" aria-live="polite">{notice}</div>
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
      <img src={MCP_ICON} width={48} height={48} alt="" />
      <div style={{ flex: "1 1 180px" }}><strong>GSW Mail app icon</strong><p className="gsw-muted">PNG · Optional for apps that support custom icons.</p></div>
      <a className="gsw-secondary-btn" href={MCP_ICON} download="gsw-mail-mcp-icon.png">Download icon</a>
    </div>
    <h3>Set up your connection</h3>
    <ol style={{ paddingLeft: 24, margin: 0, lineHeight: 1.7 }}>
      <li>Open your AI assistant's connector or MCP settings and add a remote MCP server.</li>
      <li>Name it GSW Mail, paste the link above, and use OAuth authentication. Upload the icon if supported.</li>
      <li>Sign in to your own GSW Mail account and approve the requested permissions.</li>
    </ol>
    <p className="gsw-muted">Your AI assistant can help with its setup steps. A client that supports remote MCP and OAuth is required. No API key or mailbox password needs to be shared.</p>
    <div className="gsw-settings-card-head">
      <div><h3>Manage access</h3><p>Review or disconnect authorized apps at any time in Security.</p></div>
      <button type="button" className="gsw-secondary-btn" onClick={onManageConnections}>Connected apps</button>
    </div>
  </div>;
}
