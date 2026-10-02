import { useEffect, useMemo, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { AuthCard } from "../components/auth/AuthCard";
import { AuthError } from "../components/auth/AuthError";
import { AuthPage } from "../components/auth/AuthPage";
import { BrandMark } from "../components/auth/BrandMark";
import {
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
  if (scopes.some((scope) => !scopeDescriptions[scope])) return null;

  return { clientId, scopes, acceptedScope: scopes.join(" ") };
}

export function OAuthConsentPage() {
  const request = useMemo(readConsentRequest, []);
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

  const decide = async (accept: boolean) => {
    if (!request || !client || !session) return;
    setBusy(true);
    setError("");
    try {
      await submitOAuthConsent(accept, accept ? request.acceptedScope : undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not complete this authorization request.");
      setBusy(false);
    }
  };

  return <AuthPage>
    <AuthCard>
      <BrandMark size={72} className="gsw-intro-logo" />
      <p className="gsw-setup-kicker">GSW Account · Authorization</p>
      {loading ? <>
        <h1 className="gsw-login-title">Checking this request</h1>
        <p className="gsw-login-sub">Confirming the application and your signed-in account.</p>
      </> : error && (!request || !client || !session) ? <>
        <h1 className="gsw-login-title">We couldn't verify this request</h1>
        <AuthError>{error}</AuthError>
        <p className="gsw-login-hint">For your safety, GSW will not continue an authorization request it cannot verify.</p>
      </> : <>
        <h1 className="gsw-login-title">{client?.client_name || "An application"} wants to use your GSW Account</h1>
        <p className="gsw-login-sub">Review exactly what this application is asking GSW to share.</p>

        <div className="gsw-consent-account">
          <span>Signed in as</span>
          <strong>{session?.user.name || session?.user.email}</strong>
          <small>{session?.user.email}</small>
        </div>

        <div className="gsw-consent-access" aria-label="Requested access">
          <h2>Requested access</h2>
          {request?.scopes.map((scope) => {
            const detail = scopeDescriptions[scope];
            return <div className="gsw-consent-scope" key={scope}>
              <ShieldCheck size={20} aria-hidden="true" />
              <div><strong>{detail.title}</strong><p>{detail.description}</p></div>
            </div>;
          })}
        </div>

        <div className="gsw-consent-boundary">
          <strong>This does not grant access to your GSW Mail data.</strong>
          <p>Identity permissions do not allow this application to read your mailboxes, messages, calendar, contacts, or other GSW product data.</p>
        </div>

        {error && <AuthError>{error}</AuthError>}
        <div className="gsw-consent-actions">
          <button className="gsw-btn gsw-btn-quiet" disabled={busy} onClick={() => void decide(false)}>Cancel</button>
          <button className="gsw-btn gsw-btn-primary" disabled={busy} onClick={() => void decide(true)}>{busy ? "Continuing…" : "Continue"}</button>
        </div>
        <p className="gsw-login-hint">Only continue if you recognize this application and want to share the access listed above.</p>
      </>}
    </AuthCard>
  </AuthPage>;
}
