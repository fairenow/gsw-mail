import { useMemo, useState } from "react";

type VerifiedDomain = { id: string; name: string; status: "pending" | "verified" | "failed" };

type Props = {
  organizationId: string;
  domains: VerifiedDomain[];
  isFirstMailbox: boolean;
  onCreated: (address: string) => Promise<void> | void;
};

const LOCAL_PART = /^[a-z0-9._%+-]+$/i;

export function MailboxCreatePanel({ organizationId, domains, isFirstMailbox, onCreated }: Props) {
  const verifiedDomains = useMemo(() => domains.filter((domain) => domain.status === "verified"), [domains]);
  const [domainId, setDomainId] = useState("");
  const [localPart, setLocalPart] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const selectedDomain = verifiedDomains.find((domain) => domain.id === domainId) ?? verifiedDomains[0] ?? null;
  const normalizedLocalPart = localPart.trim().toLowerCase();
  const addressPreview = selectedDomain && normalizedLocalPart ? `${normalizedLocalPart}@${selectedDomain.name}` : selectedDomain ? `username@${selectedDomain.name}` : "Verify a domain first";
  const valid = Boolean(selectedDomain && normalizedLocalPart && LOCAL_PART.test(normalizedLocalPart));

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
      setMessage(`${address} was created as a separate mailbox identity. Finish login setup below to choose its password.`);
      setLocalPart("");
      setDisplayName("");
      await onCreated(address);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create mailbox.");
    } finally {
      setBusy(false);
    }
  };

  if (!verifiedDomains.length) return <div className="gsw-control-alert"><strong>Verify a domain before creating a mailbox.</strong><span>The mailbox address must use a domain that has passed DNS verification.</span></div>;

  return <article className="gsw-control-action-card">
    <p className="gsw-setup-kicker">{isFirstMailbox ? "First mailbox" : "New mailbox"}</p>
    <h3>{isFirstMailbox ? "Create your first email address" : "Create another mailbox"}</h3>
    <p>Choose the username that appears before @. The mailbox stays separate from your workspace recovery identity and will get its own sign-in password.</p>
    <label className="gsw-auth-field">Display name<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Ramon Williams" /></label>
    <label className="gsw-auth-field">Email username<input value={localPart} onChange={(event) => setLocalPart(event.target.value.replace(/\s+/g, "").toLowerCase())} placeholder="ramon" autoCapitalize="none" /></label>
    {verifiedDomains.length > 1 && <label className="gsw-auth-field">Verified domain<select value={selectedDomain?.id ?? ""} onChange={(event) => setDomainId(event.target.value)}>{verifiedDomains.map((domain) => <option key={domain.id} value={domain.id}>{domain.name}</option>)}</select></label>}
    <div className="gsw-control-note"><strong>Email address</strong><br />{addressPreview}</div>
    {error && <p className="gsw-login-error">{error}</p>}
    {message && <p className="gsw-control-message">{message}</p>}
    <button className="gsw-btn gsw-btn-primary" disabled={!valid || busy} onClick={() => void createMailbox()}>{busy ? "Creating mailbox…" : "Create mailbox"}</button>
  </article>;
}
