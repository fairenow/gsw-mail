import { useEffect, useState, type ReactNode } from "react";
import { getSession, requestOneTimeCode, setPassword, signInWithCode, signInWithPassword, type AuthSession } from "./auth";
import { AuthCard } from "./components/auth/AuthCard";
import { AuthError } from "./components/auth/AuthError";
import { AuthPage } from "./components/auth/AuthPage";
import { BrandMark } from "./components/auth/BrandMark";

type Mode = "sign-in" | "sign-up";

export function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<Mode>(window.location.pathname === "/sign-up" ? "sign-up" : "sign-in");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPasswordValue] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  const refresh = () => void getSession().then(setSession).catch(() => setSession(null)).finally(() => setLoading(false));
  useEffect(() => { refresh(); window.addEventListener("gsw-auth-change", refresh); return () => window.removeEventListener("gsw-auth-change", refresh); }, []);

  if (loading) return <AuthPage><AuthCard><p className="gsw-login-hint">Loading GSW…</p></AuthCard></AuthPage>;
  if (session && window.location.pathname === "/create-password") return <PasswordSetup session={session} onComplete={() => window.location.assign("/setup")} />;
  if (session) return children;

  const submit = async () => {
    setError(""); setSent(false);
    try {
      if (mode === "sign-in" && password) { await signInWithPassword(email, password); refresh(); }
      else if (!code) { await requestOneTimeCode(email); setSent(true); }
      else { await signInWithCode(email, code, mode === "sign-up" ? name : undefined); if (mode === "sign-up") window.location.assign("/create-password"); else refresh(); }
    } catch (err) { setError(err instanceof Error ? err.message : "Unable to continue."); }
  };

  return <AuthPage><AuthCard>
    <BrandMark size={80} className="gsw-intro-logo" />
    <p className="gsw-setup-kicker">GSW Account</p>
    <h1 className="gsw-login-title">{mode === "sign-up" ? "Create your GSW Account" : "Welcome back"}</h1>
    <p className="gsw-login-sub">{mode === "sign-up" ? "Your backup email manages your workspace and recovery. It will not become a mailbox on your domain." : "Sign in to manage your workspace or open your mailbox."}</p>
    {mode === "sign-up" && <label className="gsw-auth-field">Name<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Ramon Williams" /></label>}
    <label className="gsw-auth-field">Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" /></label>
    {mode === "sign-in" && <label className="gsw-auth-field">Password <span className="gsw-auth-muted">or leave blank for a one-time code</span><input type="password" value={password} onChange={(event) => setPasswordValue(event.target.value)} /></label>}
    {!password && sent && <label className="gsw-auth-field">6-digit code <span className="gsw-auth-muted">Check your email</span><input inputMode="numeric" pattern="[0-9]*" maxLength={8} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} /></label>}
    {sent && !code ? <p className="gsw-login-hint">Check your inbox. We sent a one-time code to <strong>{email}</strong>.</p> : <button className="gsw-btn gsw-btn-primary gsw-btn-block" disabled={!email || (mode === "sign-up" && !name)} onClick={() => void submit()}>{mode === "sign-up" ? sent ? "Verify code" : "Email me a code" : password ? "Sign in" : sent ? "Verify code" : "Email me a code"}</button>}
    <button className="gsw-btn gsw-btn-ghost" onClick={() => { setMode(mode === "sign-up" ? "sign-in" : "sign-up"); setError(""); setSent(false); }}>{mode === "sign-up" ? "Already have a GSW Account? Sign in" : "Create a GSW Account"}</button>
    {error && <AuthError>{error}</AuthError>}
  </AuthCard></AuthPage>;
}

function PasswordSetup({ session, onComplete }: { session: AuthSession; onComplete: () => void }) {
  const [password, setPasswordValue] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const submit = async () => {
    if (password.length < 8 || password !== confirm) { setError("Use at least 8 characters and make both passwords match."); return; }
    try { await setPassword(password); onComplete(); } catch (err) { setError(err instanceof Error ? err.message : "Could not set password."); }
  };
  return <AuthPage><AuthCard><BrandMark size={64} /><p className="gsw-setup-kicker">Email verified</p><h1 className="gsw-login-title">Secure your account</h1><p className="gsw-login-sub">Create a password for {session.user.email}. You can still use one-time email links later.</p><label className="gsw-auth-field">Password<input type="password" value={password} onChange={(event) => setPasswordValue(event.target.value)} /></label><label className="gsw-auth-field">Confirm password<input type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)} /></label><button className="gsw-btn gsw-btn-primary gsw-btn-block" onClick={() => void submit()}>Continue to workspace</button>{error && <AuthError>{error}</AuthError>}</AuthCard></AuthPage>;
}
