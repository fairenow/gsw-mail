import { adminOAuthUpgradeUrl } from "../adminOAuthUpgrade";
import { useEffect, useMemo, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { AuthCard } from "../components/auth/AuthCard";
import { AuthError } from "../components/auth/AuthError";
import { AuthPage } from "../components/auth/AuthPage";
import { BrandMark } from "../components/auth/BrandMark";
import {
  establishMcpMailboxCredentials,
  getOAuthPublicClient,
  getSession,
  submitOAuthConsent,
  type AuthSession,
  type OAuthPublicClient,
} from "../auth";

const scopeDescriptions: Record<string, { title: string; description: string }> = {
  openid: {
    title: "Know who you are",
    description: "Confirm your stable GSW identity to this application.",
  },
  profile: {
    title: "See your name and profile image",
    description: "Share basic profile information from your GSW Account.",
  },
  email: {
    title: "See your email address",
    description: "Share your GSW Account email address and whether it is verified.",
  },
  offline_access: {
    title: "Stay signed in",
    description: "Maintain authorized access without asking you to sign in every time.",
  },
};

const productScopeNames = [
  "mail.read","mail.write","mail.send","mail.bulk_write",
  "calendar.read","calendar.write","contacts.read","contacts.write",
  "templates.read","templates.write","signatures.read","signatures.write",
  "files.read","files.write","images.generate","videos.generate",
  "campaign.read","campaign.write","campaign.send","research.use",
  "browser.read","browser.write","automations.read","automations.write",
  "automation.read","automation.write","tasks.read","tasks.write",
  "settings.read","settings.write","workspace.read","workspace.admin",
  "domain.read","domain.write","alias.read","alias.write",
  "mailbox_admin.read","mailbox_admin.write","admin.health.read","admin.audit.read",
] as const;
const knownProductScopes = new Set<string>(productScopeNames);
function describeScope(scope: string): {title:string;description:string} | null {
  if (scopeDescriptions[scope]) return scopeDescriptions[scope];
  if (!knownProductScopes.has(scope)) return null;
  const [domain,action] = scope.split(".");
  const label = (domain === "automation" ? "automations" : domain).replaceAll("_"," ");
  const verbs: Record<string,string> = {read:"Read",write:"Modify",send:"Send",bulk_write:"Modify in bulk",generate:"Generate",use:"Use",admin:"Administer"};
  const verb = verbs[action ?? ""] ?? "Access";
  return {title:`${verb} ${label}`,description:`${verb} GSW Mail ${label} within your existing account permissions.`};
}

interface ConsentRequestDisplay {
  clientId: string;
  scopes: string[];
  acceptedScope: string;
}

function readConsentRequest(): ConsentRequestDisplay | null {
  const params = new URLSearchParams(window.location.search);
  const clientIds = params.getAll("client_id");
  const scopeValues = params.getAll("scope");
  if (clientIds.length !== 1 || scopeValues.length !== 1) return null;

  const clientId = clientIds[0]?.trim();
  const scopes = (scopeValues[0] ?? "").split(/\s+/).map((scope) => scope.trim()).filter(Boolean);
  if (!clientId || scopes.length === 0 || !scopes.includes("openid")) return null;
  if (new Set(scopes).size !== scopes.length) return null;
  if (scopes.some((scope) => !describeScope(scope))) return null;

  return { clientId, scopes, acceptedScope: scopes.join(" ") };
}

function initials(name: string | undefined, email: string): string {
  const source = name?.trim() || email;
  return source.split(/\s+|@/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "GS";
}

export function OAuthConsentPage() {
  const request = useMemo(readConsentRequest, []);
  const [accessProfile, setAccessProfile] = useState<{ mode: "admin" | "mailbox" | "identity"; allowedScopes: string[]; permissions: {scope:string;description:string;allowed:boolean;group:string;tools:{name:string;description:string;requiredScopes:string[];risk:string}[]}[] } | null>(null);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [client, setClient] = useState<OAuthPublicClient | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const load = async () => {
      if (!request) {
        if (active) { setError("This authorization request is invalid or incomplete."); setLoading(false); }
        return;
      }
      try {
        const current = await getSession();
        if (!current) throw new Error("Your GSW session is no longer active. Please sign in again.");
        const publicClient = await getOAuthPublicClient(request.clientId);
        if (!active) return;
        if (!publicClient?.client_id || publicClient.client_id !== request.clientId) {
          throw new Error("This application is not registered with GSW.");
        }
        const profileResponse = await fetch("/product/mcp/access-profile", {credentials:"include"});
        if (!profileResponse.ok) throw new Error("Could not verify this account's MCP permissions.");
        const profile = await profileResponse.json();
        if (!active) return;
        setAccessProfile(profile);
        setSession(current);
        setClient(publicClient);
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "Could not load this authorization request.");
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => { active = false; };
  }, [request]);

  const needsAdminUpgrade = accessProfile?.mode === "admin" && accessProfile.allowedScopes.some(scope => !scopeDescriptions[scope] && !request?.scopes.includes(scope));

  const decide = async (accept: boolean, upgradeAdmin = true) => {
    if (!request || !client || !session || !accessProfile) return;
    const acceptedScopes = request.scopes.filter(scope => accessProfile.allowedScopes.includes(scope) || (accessProfile.mode === "mailbox" && ["automation.read", "automation.write"].includes(scope)));
    setBusy(true);
    setError("");
    try {
      if (accept && needsAdminUpgrade && upgradeAdmin) {
        window.location.assign(adminOAuthUpgradeUrl(window.location.search,accessProfile.allowedScopes));
        return;
      }
      // Mailbox credential brokerage is separate from OAuth consent.
      // Failure to provision a mailbox credential must not reject requested
      // OAuth scopes. Mail operations still fail closed at execution.
      if (accept && accessProfile.mode === "mailbox" && acceptedScopes.some((scope) => /^(mail|calendar)\./.test(scope))) {
        try {
          await establishMcpMailboxCredentials();
        } catch {
          // An unavailable first-party mailbox credential is not consent denial.
        }
      }
      await submitOAuthConsent(accept, accept ? acceptedScopes.join(" ") : undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not complete this authorization request.");
      setBusy(false);
    }
  };

  return <AuthPage>
    <AuthCard className="gsw-login-card gsw-consent-card">
      {loading ? <div className="gsw-consent-loading">
        <BrandMark size={64} className="gsw-intro-logo" />
        <h1 className="gsw-login-title">Checking this request</h1>
        <p className="gsw-login-sub">Confirming the application and your signed-in account.</p>
      </div> : error && (!request || !client || !session) ? <div className="gsw-consent-loading">
        <BrandMark size={64} className="gsw-intro-logo" />
        <h1 className="gsw-login-title">We couldn't verify this request</h1>
        <AuthError>{error}</AuthError>
        <p className="gsw-login-hint">For your safety, GSW will not continue an authorization request it cannot verify.</p>
      </div> : <div className="gsw-consent-layout">
        <section className="gsw-consent-intro">
          <BrandMark size={64} className="gsw-intro-logo" />
          <p className="gsw-setup-kicker">GSW Account · Authorization</p>
          <h1 className="gsw-login-title">{client?.client_name || "An application"} wants to use your GSW Account</h1>
          <p className="gsw-login-sub">{accessProfile?.mode === "admin" ? "Workspace administration connection. Mailbox messages, drafts and sending tools are excluded." : accessProfile?.mode === "mailbox" ? "Mailbox connection. Workspace administration tools are excluded, even if this mailbox has a legacy owner role." : "Identity connection only. No workspace or mailbox tools are available."}</p>

          <div className="gsw-consent-account">
            <div className="gsw-consent-avatar" aria-hidden="true">
              {session?.user.image ? <img src={session.user.image} alt="" referrerPolicy="no-referrer" /> : <span>{session ? initials(session.user.name, session.user.email) : "GS"}</span>}
            </div>
            <div className="gsw-consent-account-copy">
              <span>Signed in as</span>
              <strong>{session?.user.name || session?.user.email}</strong>
              <small>{session?.user.email}</small>
            </div>
          </div>
        </section>

        <section className="gsw-consent-details">
          <div className="gsw-consent-scope-list" role="region" aria-label="Permissions and tool access" tabIndex={0}>
          <div className="gsw-consent-access">
            <h2>{accessProfile?.mode === "admin" ? "Workspace administration permissions" : accessProfile?.mode === "mailbox" ? "Mailbox permissions" : "Identity permissions"}</h2>
            {request?.scopes.some(scope => !accessProfile?.allowedScopes.includes(scope) && !(accessProfile?.mode === "mailbox" && ["automation.read","automation.write"].includes(scope))) && <p role="status">The application also requested permissions for another account type. Those permissions are excluded from this connection.</p>}
            <div>
            {request?.scopes.filter(scope => accessProfile?.allowedScopes.includes(scope) || (accessProfile?.mode === "mailbox" && ["automation.read","automation.write"].includes(scope))).map((scope) => {
              const detail = describeScope(scope)!;
              const permission = accessProfile?.permissions.find(item => item.scope === scope.replace(/^automation\./,"automations."));
              return <div className="gsw-consent-scope" key={scope}>
                <ShieldCheck size={20} aria-hidden="true" />
                <div><strong>{permission ? scope : detail.title}</strong><p>{permission?.description ?? detail.description}</p>{permission && <details><summary>Tools requiring this permission ({permission.tools.length})</summary>{permission.tools.length ? <ul>{permission.tools.map(tool => <li key={tool.name}><strong>{tool.name}</strong>: {tool.description}<br />Required permissions: {tool.requiredScopes.join(", ")}{tool.risk !== "read" ? " · Changes data or has external effects; execution approvals still apply." : ""}</li>)}</ul> : <p>No MCP tools are currently exposed for this permission.</p>}</details>}</div>
              </div>;
            })}
            </div>
          </div>

          <details><summary>Other {accessProfile?.mode === "admin" ? "administration" : "mailbox"} permissions not requested</summary><p>These are not granted to this application. It must request them in a new authorization flow.</p>{accessProfile?.permissions.filter(permission => permission.allowed && !request?.scopes.includes(permission.scope)).map(permission => <p key={permission.scope}><strong>{permission.scope}</strong>: {permission.description}</p>)}</details>
          </div>

          {needsAdminUpgrade && <p className="gsw-consent-next-step" role="status">For full admin access, select the colored “Review all admin access” button below, then approve on the next screen.</p>}


          <div className="gsw-consent-boundary">
            <strong>{request?.scopes.some((scope) => knownProductScopes.has(scope)) ? "Access stays within your account permissions." : "Only identity access is requested."}</strong>
            <p>Action confirmations still apply. You can disconnect this app in Settings → Security → Connected Apps.</p>
          </div>

          {error && <AuthError>{error}</AuthError>}
          <div className="gsw-consent-actions">
            <button className="gsw-btn gsw-btn-quiet" disabled={busy} onClick={() => void decide(false)}>Cancel</button>
            {needsAdminUpgrade && <button className="gsw-btn gsw-btn-quiet" disabled={busy} onClick={() => void decide(true,false)}>Use limited access</button>}
            <button className="gsw-btn gsw-btn-primary" disabled={busy || !accessProfile} onClick={() => void decide(true)}>{busy ? "Continuing…" : needsAdminUpgrade ? "Review all admin access" : accessProfile?.mode === "admin" ? "Approve all admin access" : "Approve access"}</button>
          </div>
          <p className="gsw-login-hint">Approve only if you trust this application.</p>
        </section>
      </div>}
    </AuthCard>
  </AuthPage>;
}
