import { useCallback, useEffect, useState } from "react";

type DnsRecord = {
  source: "stalwart" | "resend" | "gsw";
  type: "MX" | "TXT" | "CNAME";
  name: string;
  value: string;
  priority?: number;
  purpose: "mx" | "spf" | "dkim" | "dmarc" | "other";
  required: boolean;
};

type DomainRow = {
  id: string;
  name: string;
  status: "pending" | "verified" | "failed";
  mxStatus: string;
  spfStatus: string;
  dkimStatus: string;
  dmarcStatus: string;
  updatedAt: string;
  stalwartDomainId: string | null;
  resendDomainId: string | null;
  expectedRecords: DnsRecord[] | null;
  lastCheckedAt: string | null;
  lastHealthyAt: string | null;
  lastError: string | null;
};

const human = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const tone = (value: string) => value === "verified" || value === "ready" || value === "active" ? "good" : value === "failed" ? "bad" : "warn";
const date = (value: string | null) => value ? new Date(value).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "Not checked yet";

function readiness(domain: DomainRow) {
  if (domain.status === "verified") return { label: "Ready", tone: "good" };
  if (domain.status === "failed") return { label: "Issue detected", tone: "bad" };
  if (!domain.expectedRecords?.length) return { label: "DNS setup required", tone: "warn" };
  return { label: "Verifying DNS", tone: "warn" };
}

export function DomainAdminPanel({ organizationId }: { organizationId: string }) {
  const [domains, setDomains] = useState<DomainRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [newDomain, setNewDomain] = useState("");
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!organizationId) return;
    const response = await fetch(`/admin/domains?organizationId=${encodeURIComponent(organizationId)}`, { credentials: "include", signal: AbortSignal.timeout(15000) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "Could not load domains.");
    setDomains(result.domains as DomainRow[]);
  }, [organizationId]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void load().catch((err) => { if (active) setError(err instanceof Error ? err.message : "Could not load domains."); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [load]);

  const addDomain = async () => {
    const domain = newDomain.trim().toLowerCase();
    if (!domain || adding) return;
    setAdding(true); setError(""); setMessage("");
    try {
      const response = await fetch("/admin/domains", { method: "POST", headers: { "content-type": "application/json" }, credentials: "include", body: JSON.stringify({ organizationId, domain }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not add domain.");
      setNewDomain("");
      setMessage(`${domain} was added. Copy the DNS records below to your DNS provider, then run Check DNS.`);
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : "Could not add domain."); }
    finally { setAdding(false); }
  };

  const verify = async (domain: DomainRow) => {
    if (busyId) return;
    setBusyId(domain.id); setError(""); setMessage("");
    try {
      const response = await fetch(`/admin/domains/${domain.id}/verify`, { method: "POST", credentials: "include" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not verify DNS.");
      setMessage(result.healthy ? `${domain.name} is ready. All required public DNS records match.` : `${domain.name} is not ready yet. Missing or mismatched records are shown below.`);
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : "Could not verify DNS."); }
    finally { setBusyId(null); }
  };

  const copy = async (value: string) => {
    await navigator.clipboard.writeText(value);
    setMessage("Copied DNS value.");
  };

  return <section className="gsw-control-section">
    <div className="gsw-control-section-head">
      <div><p className="gsw-setup-kicker">Domains</p><h3>Domains & DNS readiness</h3><p>A domain is only marked Ready after GSW confirms the required records are visible in public DNS.</p></div>
    </div>

    <article className="gsw-domain-add-card">
      <div><strong>Add another mail domain</strong><p>GSW provisions the domain with Stalwart, prepares outbound records with Resend when enabled, and gives you the exact DNS values to publish.</p></div>
      <div className="gsw-domain-add-row"><input value={newDomain} onChange={(event) => setNewDomain(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void addDomain(); }} placeholder="example.com" autoCapitalize="none" autoCorrect="off" /><button className="gsw-btn gsw-btn-primary" disabled={adding || !newDomain.trim()} onClick={() => void addDomain()}>{adding ? "Adding…" : "Add domain"}</button></div>
    </article>

    {message && <div className="gsw-control-message">{message}</div>}
    {error && <div className="gsw-control-alert"><strong>Domain setup needs attention.</strong><span>{error}</span></div>}
    {loading && <div className="gsw-control-empty">Loading domains…</div>}

    {!loading && domains.length === 0 && <div className="gsw-control-empty"><strong>No mail domains connected.</strong><p>Add a domain above to begin provisioning.</p></div>}

    {domains.map((domain) => {
      const state = readiness(domain);
      const records = domain.expectedRecords ?? [];
      return <article className="gsw-domain-card" key={domain.id}>
        <div className="gsw-control-row-head">
          <div><h4>{domain.name}</h4><p>Last public DNS check: {date(domain.lastCheckedAt)}</p></div>
          <div className="gsw-domain-actions"><span className={`gsw-status-pill tone-${state.tone}`}>{state.label}</span><button className="gsw-btn gsw-btn-quiet" disabled={busyId === domain.id} onClick={() => void verify(domain)}>{busyId === domain.id ? "Checking…" : records.length ? "Check DNS" : "Prepare DNS"}</button></div>
        </div>

        <div className="gsw-domain-service-state"><span><strong>Stalwart</strong>{domain.stalwartDomainId ? "Provisioned" : "Not provisioned"}</span><span><strong>Outbound</strong>{domain.resendDomainId ? "Resend connected" : "Stalwart / manual"}</span><span><strong>Last healthy</strong>{date(domain.lastHealthyAt)}</span></div>

        <div className="gsw-dns-grid">
          {[["MX", domain.mxStatus], ["SPF", domain.spfStatus], ["DKIM", domain.dkimStatus], ["DMARC", domain.dmarcStatus]].map(([label, value]) => <div key={label}><strong>{label}</strong><span className={`gsw-status-dot tone-${tone(value)}`}>{human(value)}</span></div>)}
        </div>

        {domain.lastError && <p className="gsw-domain-warning">Infrastructure note: {domain.lastError}</p>}

        {records.length > 0 && <div className="gsw-dns-records">
          <div className="gsw-dns-records-head"><strong>DNS records to publish</strong><span>Required records must match before the domain becomes Ready.</span></div>
          {records.map((record, index) => <div className="gsw-dns-record-row" key={`${record.source}-${record.type}-${record.name}-${index}`}>
            <div><span className="gsw-dns-source">{record.source}</span><strong>{record.purpose.toUpperCase()} · {record.type}</strong>{record.required ? <small>Required</small> : <small>Optional for current routing</small>}</div>
            <div><small>Host / Name</small><code>{record.name}</code></div>
            {record.type === "MX" && <div><small>Priority</small><code>{record.priority ?? 0}</code></div>}
            <div className="gsw-dns-value"><small>Value</small><code>{record.value}</code></div>
            <button className="gsw-btn gsw-btn-ghost" onClick={() => void copy(record.value)}>Copy value</button>
          </div>)}
        </div>}
      </article>;
    })}
  </section>;
}
