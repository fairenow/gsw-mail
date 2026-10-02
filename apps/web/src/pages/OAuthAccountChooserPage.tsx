import { useEffect, useMemo, useState } from "react";
import { UserRound } from "lucide-react";
import {
  continueOAuthAfterAccountSelection,
  getOAuthPublicClient,
  getSession,
  listDeviceSessions,
  setActiveDeviceSession,
  type DeviceSession,
  type OAuthPublicClient,
} from "../auth";
import { AuthError } from "../components/auth/AuthError";
import { BrandMark } from "../components/auth/BrandMark";
import { getRememberedIdentities, rememberIdentity, setAuthPrefillEmail, type RememberedGswIdentity } from "../lib/rememberedIdentities";

type ChooserRow = RememberedGswIdentity & {
  sessionToken?: string;
  signedIn: boolean;
  active: boolean;
};

function readClientId(): string | null {
  const params = new URLSearchParams(window.location.search);
  const values = params.getAll("client_id");
  if (values.length !== 1) return null;
  return values[0]?.trim() || null;
}

function initials(name: string, email: string): string {
  const source = name.trim() || email.trim();
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0] ?? ""}${parts[parts.length - 1][0] ?? ""}`.toUpperCase();
  return source.slice(0, 1).toUpperCase() || "G";
}

function signInPath(): string {
  return `/sign-in${window.location.search}#use-another-account`;
}

export function OAuthAccountChooserPage() {
  const clientId = useMemo(readClientId, []);
  const [client, setClient] = useState<OAuthPublicClient | null>(null);
  const [rows, setRows] = useState<ChooserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void (async () => {
      if (!clientId) {
        setError("This authorization request is invalid or incomplete.");
        setLoading(false);
        return;
      }
      try {
        const [current, publicClient, deviceSessions] = await Promise.all([
          getSession(),
          getOAuthPublicClient(clientId),
          listDeviceSessions(),
        ]);
        if (!active) return;
        if (!current) throw new Error("Your GSW session is no longer active. Please sign in again.");
        if (!publicClient?.client_id || publicClient.client_id !== clientId) throw new Error("This application is not registered with GSW.");

        const liveById = new Map<string, DeviceSession>();
        for (const item of deviceSessions) {
          if (!item?.user?.id || !item?.session?.token) continue;
          liveById.set(item.user.id, item);
          rememberIdentity({ id: item.user.id, email: item.user.email, name: item.user.name || item.user.email, image: item.user.image });
        }
        rememberIdentity({ id: current.user.id, email: current.user.email, name: current.user.name || current.user.email, image: current.user.image });

        const remembered = getRememberedIdentities();
        const merged = remembered.map<ChooserRow>((identity) => {
          const live = liveById.get(identity.id);
          return {
            ...identity,
            ...(live ? {
              email: live.user.email,
              name: live.user.name || live.user.email,
              image: live.user.image ?? identity.image,
              sessionToken: live.session.token,
            } : {}),
            signedIn: Boolean(live),
            active: identity.id === current.user.id,
          };
        });

        if (!merged.some((item) => item.id === current.user.id)) {
          merged.unshift({
            id: current.user.id,
            email: current.user.email,
            name: current.user.name || current.user.email,
            image: current.user.image,
            lastUsedAt: new Date().toISOString(),
            signedIn: true,
            active: true,
          });
        }

        setClient(publicClient);
        setRows(merged);
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "Could not load your GSW accounts.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [clientId]);

  const choose = async (row: ChooserRow) => {
    setError("");
    if (!row.signedIn) {
      setAuthPrefillEmail(row.email);
      window.location.assign(signInPath());
      return;
    }

    setBusyId(row.id);
    try {
      if (!row.active) {
        if (!row.sessionToken) throw new Error("This account needs to sign in again.");
        await setActiveDeviceSession(row.sessionToken);
      }
      rememberIdentity({ id: row.id, email: row.email, name: row.name, image: row.image });
      await continueOAuthAfterAccountSelection();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not select this GSW Account.");
      setBusyId("");
    }
  };

  const another = () => {
    window.sessionStorage.removeItem("gsw-auth-prefill-email");
    window.location.assign(signInPath());
  };

  return <main className="gsw-account-chooser-page">
    <section className="gsw-account-chooser-card" aria-live="polite">
      <div className="gsw-account-chooser-brand"><BrandMark size={48} /><span>Sign in with GSW</span></div>
      <div className="gsw-account-chooser-rule" />
      <div className="gsw-account-chooser-heading">
        <BrandMark size={64} />
        <h1>Choose an account</h1>
        <p>to continue to <strong>{client?.client_name || "this application"}</strong></p>
      </div>

      {loading ? <div className="gsw-account-chooser-loading">Loading your GSW Accounts…</div> : <>
        {rows.map((row) => <button key={row.id} className={`gsw-account-choice ${row.active ? "active" : ""}`} disabled={Boolean(busyId)} onClick={() => void choose(row)}>
          <span className="gsw-account-choice-avatar">
            {row.image ? <img src={row.image} alt="" referrerPolicy="no-referrer" /> : initials(row.name, row.email)}
          </span>
          <span className="gsw-account-choice-copy"><strong>{row.name || row.email}</strong><small>{row.email}</small></span>
          <span className="gsw-account-choice-status">{busyId === row.id ? "Continuing…" : row.signedIn ? (row.active ? "Current" : "Signed in") : "Signed out"}</span>
        </button>)}

        <button className="gsw-account-choice gsw-account-choice-other" disabled={Boolean(busyId)} onClick={another}>
          <span className="gsw-account-choice-avatar gsw-account-choice-user"><UserRound size={22} /></span>
          <span className="gsw-account-choice-copy"><strong>Use another account</strong></span>
        </button>
      </>}

      {error && <AuthError>{error}</AuthError>}
      <p className="gsw-account-chooser-privacy">GSW only shares the information you approve on the next screen. Identity access does not grant access to your mailbox, messages, calendar, or contacts.</p>
      <footer><a href="/privacy">Privacy</a><a href="/terms">Terms</a></footer>
    </section>
  </main>;
}
