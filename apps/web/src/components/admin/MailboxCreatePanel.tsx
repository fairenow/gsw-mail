import { useState } from "react";

type VerifiedDomain = { id: string; name: string; status: "pending" | "verified" | "failed" };

type Props = {
  organizationId: string;
  domains: VerifiedDomain[];
  isFirstMailbox: boolean;
  onCreated: (address: string) => Promise<void> | void;
  selectedDomainId: string;
  onDomainChange: (domainId: string) => void;
};

const LOCAL_PART = /^[a-z0-9._%+-]+$/i;

export function MailboxCreatePanel({ organizationId, domains, isFirstMailbox, onCreated, selectedDomainId, onDomainChange }: Props) {
  const [localPart, setLocalPart] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const selectedDomain = domains.find((domain) => domain.id === selectedDomainId) ?? domains[0] ?? null;
  const domainReady = selectedDomain?.status === "verified";
  const normalizedLocalPart = localPart.trim().toLowerCase();
  const addressPreview = selectedDomain && normalizedLocalPart ? `${normalizedLocalPart}@${selectedDomain.name}` : selectedDomain ? `username@${selectedDomain.name}` : "Verify a domain first";
  const valid = Boolean(domainReady && normalizedLocalPart && LOCAL_PART.test(normalizedLocalPart));

  const createMailbox = async () => {
    if (!selectedDomain || !valid || busy) return;
    setBusy(true); setMessage(""); setError("");
    try {
      const response = await fetch("/mail/accounts", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          organizationId,
          domainId: selectedDomain.id,
          localPart: normalizedLocalPart,
          displayName: displayName.trim() || undefined,
        }),
        signal: AbortSignal.timeout(20_000),
      });
      const result = await response.json().catch(() => ({})) as { address?: string; error?: string; message?: string };
      if (!response.ok) throw new Error(result.message ?? result.error ?? "Could not create mailbox.");
      const address = result.address ?? `${normalizedLocalPart}@${selectedDomain.name}`;
      setMessage(`${address} was created. It has its own mailbox identity and does not become part of the admin account.`);
      setLocalPart("");
      setDisplayName("");
      await onCreated(address);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create mailbox.");
    } finally {
      setBusy(false);
    }
  };

  if (!domains.length) return <div className="gsw-control-alert"><strong>Add a mail domain first.</strong><span>Then verify its DNS records before creating a mailbox.</span></div>;

  return <article className="gsw-control-action-card">
    <p className="gsw-setup-kicker">{isFirstMailbox ? "First mailbox" : "New mailbox"}</p>
    <h3>{isFirstMailbox ? "Create your first email address" : "Create another mailbox"}</h3>
    <p>Create an email address on a verified domain. This mailbox is a separate identity from the workspace owner/admin account and gets its own sign-in.</p>
    <label className="gsw-auth-field">Display name<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Ramon Williams" /></label>
    <label className="gsw-auth-field">Email username<input value={localPart} onChange={(event) => setLocalPart(event.target.value.replace(/\s+/g, "").toLowerCase())} placeholder="ramon" autoCapitalize="none" /></label>
    <label className="gsw-auth-field">Manage domain<select value={selectedDomain?.id ?? ""} onChange={(event) => onDomainChange(event.target.value)}>{domains.map((domain) => <option key={domain.id} value={domain.id}>{domain.name} {domain.status === "verified" ? "(Ready)" : "(DNS verification required)"}</option>)}</select></label>
    {!domainReady && <div className="gsw-control-alert"><strong>Mailbox creation is disabled for this domain.</strong><span>Finish DNS verification for {selectedDomain?.name} in Domains, then return here.</span></div>}
    <div className="gsw-control-note"><strong>Email address</strong><br />{addressPreview}</div>
    {error && <p className="gsw-login-error">{error}</p>}
    {message && <p className="gsw-control-message">{message}</p>}
    <button className="gsw-btn gsw-btn-primary" disabled={!valid || busy} onClick={() => void createMailbox()}>{busy ? "Creating mailbox…" : "Create mailbox"}</button>
  </article>;
}
