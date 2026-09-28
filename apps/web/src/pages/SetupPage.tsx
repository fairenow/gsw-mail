import { useEffect, useState } from "react";
import { api, type SetupState } from "../api";
import { AuthCard } from "../components/auth/AuthCard";
import { AuthPage } from "../components/auth/AuthPage";
import { BrandMark } from "../components/auth/BrandMark";
import { SetupDnsPanel } from "../components/auth/SetupDnsPanel";

const steps = ["Workspace", "Domain", "DNS verification", "First mailbox"];
type DomainSetupResponse = Pick<SetupState, "domain" | "currentStep"> & { infrastructureError?: string };

export function SetupPage() {
  const [setup, setSetup] = useState<SetupState | null>(null);
  const [workspaceName, setWorkspaceName] = useState("");
  const [domain, setDomain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refreshSetup = async () => {
    const state = await api.setup();
    setSetup(state);
    setWorkspaceName(state.workspace.name);
    setDomain(state.domain?.name ?? "");
  };

  useEffect(() => {
    void refreshSetup().catch((err: unknown) => setError(err instanceof Error ? err.message : "Could not load setup."));
  }, []);

  if (!setup) return <AuthPage><AuthCard><p className="gsw-login-hint">Loading your workspace…</p>{error && <p className="gsw-login-error">{error}</p>}</AuthCard></AuthPage>;

  const stepIndex = setup.currentStep === "email_verified" ? 0 : setup.currentStep === "workspace_created" ? 1 : setup.currentStep === "domain_added" ? 2 : 3;
  const saveWorkspace = async () => {
    setBusy(true); setError(""); setNotice("");
    try { const result = await api.updateWorkspace(workspaceName); setSetup((current) => current ? { ...current, ...result } : current); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not save workspace."); }
    finally { setBusy(false); }
  };
  const saveDomain = async () => {
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await api.addSetupDomain(domain) as DomainSetupResponse;
      setSetup((current) => current ? { ...current, ...result } : current);
      if (result.domain?.name) setDomain(result.domain.name);
      if (result.infrastructureError) setNotice(`Domain saved. Provider setup still needs attention: ${result.infrastructureError}`);
    }
    catch (err) { setError(err instanceof Error ? err.message : "Could not add domain."); }
    finally { setBusy(false); }
  };

  return <AuthPage><AuthCard className="gsw-setup-card">
    <BrandMark size={62} />
    <p className="gsw-setup-kicker">GSW Account · {setup.onboardingComplete ? "Existing setup" : "Workspace setup"}</p>
    <h1 className="gsw-login-title">{setup.onboardingComplete ? "Your email is ready" : "Build your workspace"}</h1>
    <p className="gsw-login-sub">{setup.onboardingComplete ? "Your existing mail system was linked without recreating domains, mailboxes, or mail data." : "Your backup email remains your control-plane identity. It will not become a mailbox on your domain."}</p>
    {setup.onboardingComplete && <section className="gsw-reconcile"><h2>Existing setup</h2><p><strong>{setup.workspace.name}</strong> ✓</p><p>{setup.domain ? `${setup.domain.name} ✓` : "No domain linked"}</p><p>{setup.mailbox ? `${setup.mailbox.address} ✓` : "No mailbox linked"}</p><button className="gsw-btn gsw-btn-primary gsw-btn-block" onClick={() => window.location.assign("/")}>Continue to Mail</button></section>}
    <div className="gsw-setup-steps">{steps.map((step, index) => <span className={index <= stepIndex ? "is-active" : ""} key={step}><b>{index + 1}</b>{step}</span>)}</div>
    {stepIndex === 0 && <section className="gsw-setup-section"><h2>Name your workspace</h2><label>Workspace name<input value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} placeholder="Guided Steps Wellness" /></label><button className="gsw-btn gsw-btn-primary gsw-btn-block" disabled={busy || !workspaceName.trim()} onClick={() => void saveWorkspace()}>Continue</button></section>}
    {stepIndex >= 1 && <section className="gsw-setup-section"><h2>{setup.workspace.name}</h2><p className="gsw-setup-note">Workspace owner and mailbox identities are separate. You can recover this workspace with your backup email even if mail is unavailable.</p>{!setup.domain ? <><label>Domain you already own<input value={domain} onChange={(event) => setDomain(event.target.value)} placeholder="example.com or https://example.com" /></label><button className="gsw-btn gsw-btn-primary gsw-btn-block" disabled={busy || !domain.trim()} onClick={() => void saveDomain()}>{busy ? "Adding domain…" : "Add domain"}</button></> : <><div className="gsw-setup-domain"><strong>{setup.domain.name}</strong><span>{setup.domain.status === "pending" ? "Domain saved · DNS verification is next" : setup.domain.status}</span></div>{setup.domain.status !== "verified" ? <><SetupDnsPanel organizationId={setup.workspace.id} domainId={setup.domain.id} domainName={setup.domain.name} onVerified={refreshSetup} /><button className="gsw-btn gsw-btn-quiet gsw-btn-block" disabled={busy} onClick={() => void saveDomain()}>{busy ? "Preparing…" : "Retry provider provisioning"}</button></> : setup.mailbox ? <button className="gsw-btn gsw-btn-primary gsw-btn-block" onClick={() => window.location.assign("/")}>Continue to Mail</button> : <button className="gsw-btn gsw-btn-primary gsw-btn-block" onClick={() => window.location.assign("/control-center#mailboxes")}>Continue to first mailbox</button>}</>}</section>}
    {notice && <div className="gsw-setup-dns-note"><strong>Setup note</strong><span>{notice}</span></div>}
    {error && <p className="gsw-login-error">{error}</p>}
  </AuthCard></AuthPage>;
}
