import { useEffect, useState } from "react";

type Installation = { id: string; name: string; accountId: string; testMode: boolean; active: boolean; allowedRecipients: string[]; dailyLimit: number };
type ApiKey = { id: string; name: string; prefix: string; expiresAt: string; revokedAt: string | null };
type ServiceStatus = { health: string; acceptedEmails: number; recentEmails: { id: string; testMode: boolean; status: string | null; failureCode: string | null }[]; recentOperations: { name: string; status: string; createdAt: string }[] };
type Mailbox = { id: string; address: string; status: string; authSetupStatus: string };
async function request<T>(path: string, method = "GET", body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { method, credentials: "include", headers: { "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: signal ?? AbortSignal.timeout(15000) });
  const result = await response.json();
  if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : "The request could not be completed.");
  return result as T;
}

export function IntegrationDeliveryPanel({ organizationId, mailboxes }: { organizationId: string; mailboxes: Mailbox[] }) {
  const [installations, setInstallations] = useState<Installation[]>([]);
  const [services, setServices] = useState<Record<string, ServiceStatus>>({});
  const [keys, setKeys] = useState<Record<string, ApiKey[]>>({});
  const [name, setName] = useState("");
  const [accountId, setAccountId] = useState("");
  const [testMode, setTestMode] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [secret, setSecret] = useState("");
  const readyMailboxes = mailboxes.filter(m => m.status === "active" && m.authSetupStatus === "ready");
  const senderId = accountId || readyMailboxes[0]?.id || "";
  const base = "/api/admin/integrations";
  const reload = async () => {
    const result = await request<{ installations: Installation[] }>(`${base}?organizationId=${encodeURIComponent(organizationId)}`);
    setInstallations(result.installations);
  };
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    request<{ installations: Installation[] }>(`${base}?organizationId=${encodeURIComponent(organizationId)}`, "GET", undefined, controller.signal)
      .then(result => { if (!controller.signal.aborted) setInstallations(result.installations); })
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not load connections."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [organizationId]);
  const perform = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setError("");
    try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : "The request failed."); } finally { setBusy(false); }
  };
  const loadKeys = async (id: string) => {
    const result = await request<{ keys: ApiKey[] }>(`${base}/${id}/keys`);
    setKeys(previous => ({ ...previous, [id]: result.keys }));
  };
  return <section className="gsw-control-section">
    <div className="gsw-control-section-head"><div><p className="gsw-setup-kicker">GSW Mailbox API</p><h3>API keys and connections</h3><p>Connect an application to a mailbox with full access to its available mail, calendar, contacts, files and AI functions. Workspace and domain administration are excluded.</p></div></div>
    <p>The sending mailbox must be ready and its domain verified. Live sending also requires verified SPF, DKIM and DMARC, plus an existing mailbox authorization. Keep API keys on your application server.</p>
    <p><a className="gsw-btn gsw-btn-quiet" href="/api/admin/integrations/docs" target="_blank" rel="noreferrer">Open API documentation</a></p>
    <p>Base URL: <code>{window.location.origin}/integrations/v1</code> · Discover available functions at <code>GET /capabilities</code>.</p>
    {error && <p role="alert">{error}</p>}
    {secret && <div className="gsw-audit-card" role="status"><h4>Save your API key</h4><p>This key is shown once. Copy it into your server’s secret settings before dismissing.</p><label className="gsw-auth-field">New API key<input readOnly value={secret} onFocus={event => event.currentTarget.select()} autoComplete="off" spellCheck={false} /></label><button className="gsw-btn gsw-btn-quiet" onClick={() => setSecret("")}>I’ve saved the key</button></div>}
    <form onSubmit={event => { event.preventDefault(); void perform(async () => {
      await request(base, "POST", { organizationId, accountId: senderId, name, testMode });
      setName(""); await reload();
    }); }}>
      <label className="gsw-auth-field">Connection name<input required maxLength={100} value={name} onChange={event => setName(event.target.value)} placeholder="Safe Place Ministries website" /></label>
      <label className="gsw-auth-field">Mailbox<select required value={senderId} onChange={event => setAccountId(event.target.value)}><option value="" disabled>Select a ready mailbox</option>{readyMailboxes.map(mailbox => <option key={mailbox.id} value={mailbox.id}>{mailbox.address}</option>)}</select></label>
      <label><input type="checkbox" checked={testMode} onChange={event => setTestMode(event.target.checked)} /> Test mode: simulate API calls without executing actions</label>
      {!testMode && <p>Live mode enables real mailbox actions using this key.</p>}
      <div><button className="gsw-btn gsw-btn-primary" disabled={busy || loading || !senderId} type="submit">{busy ? "Working…" : "Create connection"}</button></div>
    </form>
    <h4>Your connections</h4>
    {loading ? <p role="status">Loading connections…</p> : installations.length === 0 ? <p>No website connections yet.</p> : installations.map(installation => <article className="gsw-audit-card" key={installation.id}>
      <h4>{installation.name}</h4><p>{installation.testMode ? "Test" : "Live"} · {installation.active ? "Active" : "Paused"} · {installation.dailyLimit} direct email submissions per UTC day</p>
      <p>Mailbox: {mailboxes.find(m => m.id === installation.accountId)?.address ?? installation.accountId}</p><p>Access: full mailbox</p>
      <p>Sender ID: <code>{installation.accountId}</code></p>
      <div className="gsw-control-modal-actions">
        <button className="gsw-btn gsw-btn-quiet" disabled={busy || Boolean(secret)} onClick={() => void perform(async () => {
          const created = await request<{ secret: string }>(`${base}/${installation.id}/keys`, "POST", { name: "Website server", expiresInDays: 30 });
          setSecret(created.secret); await loadKeys(installation.id);
        })}>Create 30-day server key</button>
        <button className="gsw-btn gsw-btn-quiet" disabled={busy} onClick={() => void perform(async () => { await request(`${base}/${installation.id}`, "PATCH", { active: !installation.active }); await reload(); })}>{installation.active ? "Pause connection" : "Resume connection"}</button>
        <button className="gsw-btn gsw-btn-ghost" disabled={busy} onClick={() => void perform(() => loadKeys(installation.id))}>Show keys</button>
        <button className="gsw-btn gsw-btn-ghost" disabled={busy} onClick={() => void perform(async () => { const result = await request<ServiceStatus>(`${base}/${installation.id}/service`); setServices(previous => ({ ...previous, [installation.id]: result })); })}>Check service and activity</button>
      </div>
      {services[installation.id] && <div role="status"><p>Service: {services[installation.id].health.replaceAll("_", " ")} · Accepted emails: {services[installation.id].acceptedEmails}</p><p>Recent emails: {services[installation.id].recentEmails.map(email => `${email.id.slice(0, 8)}: ${email.testMode ? "simulated" : email.status ?? "pending"}${email.failureCode ? ` (${email.failureCode})` : ""}`).join("; ") || "None"}</p><p>Recent operations: {services[installation.id].recentOperations.map(operation => `${operation.name}: ${operation.status}`).join("; ") || "None"}</p></div>}
      {keys[installation.id]?.map(key => <div className="gsw-audit-row" key={key.id}><div><strong>{key.name}</strong><span>{key.prefix}… · Expires {new Date(key.expiresAt).toLocaleDateString()} · {key.revokedAt ? "Revoked" : new Date(key.expiresAt).getTime() <= Date.now() ? "Expired" : "Active"}</span></div>{!key.revokedAt && <button className="gsw-btn gsw-btn-ghost" disabled={busy} onClick={() => void perform(async () => { await request(`${base}/${installation.id}/keys/${key.id}`, "DELETE"); await loadKeys(installation.id); })}>Revoke key</button>}</div>)}
    </article>)}
  </section>;
}
