import { useCallback, useEffect, useMemo, useState } from "react";

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
  stalwartDomainId: string | null;
  resendDomainId: string | null;
  expectedRecords: DnsRecord[] | null;
  lastCheckedAt: string | null;
  lastError: string | null;
};

type Props = {
  organizationId: string;
  domainId: string;
  domainName: string;
  onVerified: () => Promise<void> | void;
};

const human = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const tone = (value: string) => value === "verified" || value === "ready" || value === "active" ? "good" : value === "failed" ? "bad" : "warn";

export function SetupDnsPanel({ organizationId, domainId, domainName, onVerified }: Props) {
  const [domain, setDomain] = useState<DomainRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const response = await fetch(`/admin/domains?organizationId=${encodeURIComponent(organizationId)}`, { credentials: "include" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "Could not load DNS setup.");
    const row = (result.domains as DomainRow[]).find((item) => item.id === domainId) ?? null;
    setDomain(row);
    return row;
  }, [domainId, organizationId]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void load().catch((err) => { if (active) setError(err instanceof Error ? err.message : "Could not load DNS setup."); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [load]);

  const records = domain?.expectedRecords ?? [];
  const requiredCount = useMemo(() => records.filter((record) => record.required).length, [records]);

  const verify = async () => {
    if (busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch(`/admin/domains/${domainId}/verify`, { method: "POST", credentials: "include" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? result.message ?? "Could not verify DNS.");
      await load();
      if (result.healthy) {
        setMessage(`${domainName} is verified. All required DNS records match.`);
        await onVerified();
      } else {
        setMessage("DNS is not ready yet. Add or correct the required records below, then check again.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not verify DNS.");
    } finally {
      setBusy(false);
    }
  };

  const copy = async (value: string) => {
    await navigator.clipboard.writeText(value);
    setMessage("Copied DNS value.");
  };

  if (loading) return <div className="gsw-setup-dns"><p className="gsw-setup-note">Preparing DNS instructions…</p></div>;

  return <div className="gsw-setup-dns">
    <div className="gsw-setup-dns-head">
      <div><strong>DNS verification</strong><p>Publish these records with the DNS provider for {domainName}. GSW will verify them publicly before mailbox creation.</p></div>
      {domain?.status === "verified" && <span className="gsw-status-pill">Verified</span>}
    </div>

    {domain && <div className="gsw-setup-dns-status">
      <span><b>Stalwart</b>{domain.stalwartDomainId ? "Provisioned" : "Needs provisioning"}</span>
      <span><b>Outbound</b>{domain.resendDomainId ? "Resend connected" : "Needs setup"}</span>
    </div>}

    {domain?.lastError && <div className="gsw-setup-dns-note"><strong>Provider setup note</strong><span>{domain.lastError}</span></div>}
    {error && <div className="gsw-login-error">{error}</div>}
    {message && <div className="gsw-setup-dns-message">{message}</div>}

    {records.length > 0 ? <>
      <div className="gsw-setup-dns-summary">
        {[["MX", domain?.mxStatus], ["SPF", domain?.spfStatus], ["DKIM", domain?.dkimStatus], ["DMARC", domain?.dmarcStatus]].map(([label, value]) => <span key={label}><b>{label}</b><em className={`tone-${tone(value ?? "not_configured")}`}>{human(value ?? "not_configured")}</em></span>)}
      </div>
      <div className="gsw-setup-dns-records">
        {records.map((record, index) => <div className="gsw-setup-dns-record" key={`${record.source}-${record.type}-${record.name}-${index}`}>
          <div className="gsw-setup-dns-record-title"><strong>{record.purpose.toUpperCase()} · {record.type}</strong><small>{record.required ? "Required" : "Optional"} · {record.source}</small></div>
          <div><small>Host / Name</small><code>{record.name}</code></div>
          {record.type === "MX" && <div><small>Priority</small><code>{record.priority ?? 0}</code></div>}
          <div><small>Value</small><code>{record.value}</code></div>
          <button className="gsw-btn gsw-btn-quiet" onClick={() => void copy(record.value)}>Copy value</button>
        </div>)}
      </div>
      <p className="gsw-setup-note">{requiredCount} required record{requiredCount === 1 ? "" : "s"} must match before this domain is ready.</p>
    </> : <p className="gsw-setup-note">DNS records are not available yet. Prepare the domain to retrieve Stalwart and outbound-mail requirements.</p>}

    <button className="gsw-btn gsw-btn-primary gsw-btn-block" disabled={busy} onClick={() => void verify()}>{busy ? "Checking DNS…" : records.length ? "Check DNS" : "Prepare DNS"}</button>
  </div>;
}
