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

type SetupDomainResult = {
  currentStep?: string;
  infrastructureError?: string;
  verification?: { healthy?: boolean };
};

const human = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const tone = (value: string) => value === "verified" || value === "ready" || value === "active" ? "good" : value === "failed" ? "bad" : "warn";
const purposeOrder: Record<DnsRecord["purpose"], number> = { mx: 0, dmarc: 1, spf: 2, dkim: 3, other: 4 };

function recordLabel(record: DnsRecord) {
  if (record.purpose === "mx") return "MX record";
  return `${record.type} · ${record.purpose.toUpperCase()}`;
}

function optionalReason(record: DnsRecord) {
  if (record.source === "stalwart" && (record.purpose === "spf" || record.purpose === "dkim")) {
    return `${record.purpose.toUpperCase()} is optional here because outbound mail is handled by Resend. Stalwart does not need this record to pass inbound-domain verification.`;
  }
  if (record.purpose === "other") {
    return "This record supports extra mail-client, MTA-STS, TLS reporting, or autodiscovery behavior. It is useful, but it does not block domain verification or mailbox creation.";
  }
  return "This record is recommended for the provider integration but is not required to finish domain verification.";
}

async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 30_000) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) throw new Error("Provider setup took too long. Please retry.");
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

function DnsField({ label, value, onCopy }: { label: string; value: string; onCopy: (value: string) => void }) {
  return <div>
    <small>{label}</small>
    <div className="gsw-setup-dns-field">
      <code>{value}</code>
      <button type="button" className="gsw-dns-copy-icon" aria-label={`Copy ${label}`} title={`Copy ${label}`} onClick={() => onCopy(value)}>⧉</button>
    </div>
  </div>;
}

export function SetupDnsPanel({ organizationId, domainId, domainName, onVerified }: Props) {
  const [domain, setDomain] = useState<DomainRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [showMore, setShowMore] = useState(false);

  const load = useCallback(async () => {
    const response = await fetchWithTimeout(`/admin/domains?organizationId=${encodeURIComponent(organizationId)}`, { credentials: "include" }, 15_000);
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
  const sortedRecords = useMemo(() => [...records].sort((a, b) => Number(b.required) - Number(a.required) || purposeOrder[a.purpose] - purposeOrder[b.purpose] || a.name.localeCompare(b.name)), [records]);
  const requiredRecords = useMemo(() => sortedRecords.filter((record) => record.required), [sortedRecords]);
  const optionalRecords = useMemo(() => sortedRecords.filter((record) => !record.required), [sortedRecords]);
  const visibleRecords = showMore ? sortedRecords : requiredRecords;

  const prepare = async () => {
    if (busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetchWithTimeout("/api/setup/domain", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ domain: domainName }),
      }, 30_000);
      const result = await response.json() as SetupDomainResult & { error?: string; message?: string };
      if (!response.ok) throw new Error(result.error ?? result.message ?? "Could not prepare DNS records.");
      const refreshed = await load();
      if (result.infrastructureError) {
        setError(result.infrastructureError);
      } else if (result.verification?.healthy || refreshed?.status === "verified") {
        setMessage(`${domainName} is verified. All required DNS records match.`);
        await onVerified();
      } else if (refreshed?.expectedRecords?.length) {
        setMessage("DNS records are ready. Publish the required records below, then run Check DNS.");
      } else {
        setMessage("The domain was saved, but its DNS requirements are not available yet. Retry provider provisioning.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not prepare DNS records.");
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    if (busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetchWithTimeout(`/admin/domains/${domainId}/verify`, { method: "POST", credentials: "include" }, 30_000);
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
      <div><strong>DNS verification</strong><p>Publish the required records first. Optional records can be added later without blocking mailbox creation.</p></div>
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
        {[["MX", domain?.mxStatus], ["DMARC", domain?.dmarcStatus], ["SPF", domain?.spfStatus], ["DKIM", domain?.dkimStatus]].map(([label, value]) => <span key={label}><b>{label}</b><em className={`tone-${tone(value ?? "not_configured")}`}>{human(value ?? "not_configured")}</em></span>)}
      </div>
      <div className="gsw-setup-dns-records">
        {visibleRecords.map((record, index) => <div className={`gsw-setup-dns-record ${record.required ? "is-required" : "is-optional"}`} key={`${record.source}-${record.type}-${record.name}-${index}`}>
          <div className="gsw-setup-dns-record-title">
            <strong>{recordLabel(record)}</strong>
            <small className={record.required ? "gsw-dns-required" : "gsw-dns-optional"}>{record.required ? "Required" : "Optional"} · {record.source}{!record.required && <span className="gsw-dns-info" title={optionalReason(record)} aria-label={optionalReason(record)}>ⓘ</span>}</small>
          </div>
          <DnsField label="Host / Name" value={record.name} onCopy={(value) => void copy(value)} />
          {record.type === "MX" && <DnsField label="Priority" value={String(record.priority ?? 0)} onCopy={(value) => void copy(value)} />}
          <DnsField label="Value" value={record.value} onCopy={(value) => void copy(value)} />
        </div>)}
      </div>
      {optionalRecords.length > 0 && <button className="gsw-btn gsw-btn-quiet gsw-btn-block" type="button" onClick={() => setShowMore((value) => !value)}>{showMore ? "Hide Optional DNS Values" : `Show More DNS Values (${optionalRecords.length})`}</button>}
      <p className="gsw-setup-note"><strong>{requiredRecords.length} required record{requiredRecords.length === 1 ? "" : "s"}</strong> must match before this domain is ready. SPF/DKIM from Stalwart and the additional service records remain optional while Resend handles outbound mail.</p>
    </> : <p className="gsw-setup-note">DNS records are not available yet. Prepare the domain to retrieve Stalwart and outbound-mail requirements.</p>}

    <button className="gsw-btn gsw-btn-primary gsw-btn-block" disabled={busy} onClick={() => void (records.length ? verify() : prepare())}>{busy ? (records.length ? "Checking DNS…" : "Preparing DNS…") : records.length ? "Check DNS" : "Prepare DNS"}</button>
  </div>;
}
