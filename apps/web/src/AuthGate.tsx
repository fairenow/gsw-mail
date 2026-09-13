import { useEffect, useState, type ReactNode } from "react";
import { getAccountContext, getSession, requestOneTimeCode, requestPasswordResetCode, resetPasswordWithCode, setPassword, signInWithCode, signInWithPassword, type AuthSession } from "./auth";
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
  const [otpRequested, setOtpRequested] = useState(false);
  const [busy, setBusy] = useState(false);
  const [routing, setRouting] = useState(false);
  const [resetMode, setResetMode] = useState(false);
  const [resetRequested, setResetRequested] = useState(false);
  const [resetPassword, setResetPasswordValue] = useState("");
  const [resetConfirm, setResetConfirm] = useState("");
  const [resetDestination, setResetDestination] = useState("");

  const refresh = () => void getSession().then(setSession).catch(() => setSession(null)).finally(() => setLoading(false));
  useEffect(() => { refresh(); window.addEventListener("gsw-auth-change", refresh); return () => window.removeEventListener("gsw-auth-change", refresh); }, []);
  useEffect(() => {
    if (!session || !["/", "/mail", "/control-center"].includes(window.location.pathname)) return;
    setRouting(true);
    void getAccountContext().then((context) => {
      const destination = context.defaultDestination === "control-center" ? "/control-center" : context.defaultDestination === "mail" ? "/mail" : "/setup";
      if (window.location.pathname !== destination) window.location.replace(destination);
      else setRouting(false);
    }).catch(() => setRouting(false));
  }, [session]);

  if (loading) return <AuthPage><AuthCard><p className="gsw-login-hint">Loading GSW…</p></AuthCard></AuthPage>;
  if (routing) return <AuthPage><AuthCard><p className="gsw-login-hint">Opening your GSW workspace…</p></AuthCard></AuthPage>;
  if (session && window.location.pathname === "/create-password") return <PasswordSetup session={session} onComplete={() => window.location.assign("/setup")} />;
  if (session) return children;

  const requestCode = async () => {
    setBusy(true); setError("");
    try { await requestOneTimeCode(email); setCode(""); setOtpRequested(true); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not send a code."); }
    finally { setBusy(false); }
  };
  const verifyCode = async () => {
    if (code.length !== 6) { setError("Enter the 6-digit code from your email."); return; }
    setBusy(true); setError("");
    try { await signInWithCode(email, code, mode === "sign-up" ? name : undefined); if (mode === "sign-up") window.location.assign("/create-password"); else refresh(); }
    catch (err) { setError(err instanceof Error ? err.message : "That code is invalid or expired."); }
    finally { setBusy(false); }
  };
  const submitPassword = async () => {
    setBusy(true); setError("");
    try { await signInWithPassword(email, password); refresh(); }
    catch (err) { setError(err instanceof Error ? err.message : "Unable to sign in."); }
    finally { setBusy(false); }
  };
  const requestReset = async () => {
    setBusy(true); setError("");
    try { const result = await requestPasswordResetCode(email); setResetDestination(result.maskedRecoveryEmail); setResetRequested(true); setCode(""); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not send a reset code."); }
    finally { setBusy(false); }
  };
  const completeReset = async () => {
    if (code.length !== 6) { setError("Enter the 6-digit reset code from your email."); return; }
    if (resetPassword.length < 8 || resetPassword !== resetConfirm) { setError("Use at least 8 characters and make both passwords match."); return; }
    setBusy(true); setError("");
    try { await resetPasswordWithCode(email, code, resetPassword); setResetMode(false); setResetRequested(false); setPasswordValue(resetPassword); setResetPasswordValue(""); setResetConfirm(""); setCode(""); }
    catch (err) { setError(err instanceof Error ? err.message : "That reset code is invalid or expired."); }
    finally { setBusy(false); }
  };

  return <AuthPage><AuthCard>
    <BrandMark size={80} className="gsw-intro-logo" />
    {resetMode ? <>
      <p className="gsw-setup-kicker">GSW Account · Recovery</p>
      <h1 className="gsw-login-title">Reset your password</h1>
      <p className="gsw-login-sub">We’ll send a reset code to your verified recovery email.</p>
      <label className="gsw-auth-field">Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" /></label>
      {!resetRequested ? <button className="gsw-btn gsw-btn-primary gsw-btn-block" disabled={busy || !email} onClick={() => void requestReset()}>Email me a reset code</button> : <><p className="gsw-login-hint">Check your {resetDestination ? "recovery" : "email"}. We sent a 6-digit code to <strong>{resetDestination}</strong>.<br /><br />This code will reset the password for <strong>{email}</strong>.</p><label className="gsw-auth-field">Reset code<input autoFocus inputMode="numeric" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} /></label><label className="gsw-auth-field">New password<input type="password" value={resetPassword} onChange={(event) => setResetPasswordValue(event.target.value)} /></label><label className="gsw-auth-field">Confirm new password<input type="password" value={resetConfirm} onChange={(event) => setResetConfirm(event.target.value)} /></label><button className="gsw-btn gsw-btn-primary gsw-btn-block" disabled={busy} onClick={() => void completeReset()}>Set new password</button><button className="gsw-btn gsw-btn-ghost" disabled={busy} onClick={() => void requestReset()}>Resend reset code</button></>}
      <button className="gsw-btn gsw-btn-quiet gsw-btn-block" onClick={() => { setResetMode(false); setResetRequested(false); setError(""); }}>Back to sign in</button>
    </> : !otpRequested ? <>
      <p className="gsw-setup-kicker">GSW Account</p>
      <h1 className="gsw-login-title">{mode === "sign-up" ? "Create your GSW Account" : "Welcome back"}</h1>
      <p className="gsw-login-sub">{mode === "sign-up" ? "Your backup email manages your workspace and recovery. It will not become a mailbox on your domain." : "Sign in to manage your workspace or open your mailbox."}</p>
      {mode === "sign-up" && <label className="gsw-auth-field">Name<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Ramon Williams" /></label>}
      <label className="gsw-auth-field">Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" /></label>
      {mode === "sign-in" && <><label className="gsw-auth-field">Password<input type="password" value={password} onChange={(event) => setPasswordValue(event.target.value)} /></label><button className="gsw-btn gsw-btn-primary gsw-btn-block" disabled={busy || !email || !password} onClick={() => void submitPassword()}>Sign in</button><button className="gsw-btn gsw-btn-quiet gsw-btn-block" onClick={() => { setResetMode(true); setError(""); }}>Forgot password?</button><div className="gsw-auth-divider">or</div></>}
      <button className={`gsw-btn ${mode === "sign-in" ? "gsw-btn-quiet" : "gsw-btn-primary"} gsw-btn-block`} disabled={busy || !email || (mode === "sign-up" && !name)} onClick={() => void requestCode()}>{mode === "sign-up" ? "Email me a one-time code" : "Email me a one-time code"}</button>
      <button className="gsw-btn gsw-btn-ghost" onClick={() => { setMode(mode === "sign-up" ? "sign-in" : "sign-up"); setError(""); setPasswordValue(""); }}>{mode === "sign-up" ? "Already have a GSW Account? Sign in" : "Create a GSW Account"}</button>
    </> : <>
      <p className="gsw-setup-kicker">GSW Account · Verification</p>
      <h1 className="gsw-login-title">Check your email</h1>
      <p className="gsw-login-sub">We sent a 6-digit code to <strong>{email}</strong>.</p>
      <label className="gsw-auth-field">Verification code<input autoFocus inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} /></label>
      <button className="gsw-btn gsw-btn-primary gsw-btn-block" disabled={busy || code.length !== 6} onClick={() => void verifyCode()}>Continue</button>
      <button className="gsw-btn gsw-btn-ghost" disabled={busy} onClick={() => void requestCode()}>Resend code</button>
      {mode === "sign-in" && <button className="gsw-btn gsw-btn-quiet gsw-btn-block" onClick={() => { setOtpRequested(false); setCode(""); setError(""); }}>Use password instead</button>}
    </>}
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
  return <AuthPage><AuthCard><BrandMark size={64} /><p className="gsw-setup-kicker">Email verified</p><h1 className="gsw-login-title">Secure your account</h1><p className="gsw-login-sub">Create a password for {session.user.email}. You can still use one-time email codes later.</p><label className="gsw-auth-field">Password<input type="password" value={password} onChange={(event) => setPasswordValue(event.target.value)} /></label><label className="gsw-auth-field">Confirm password<input type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)} /></label><button className="gsw-btn gsw-btn-primary gsw-btn-block" onClick={() => void submit()}>Continue to workspace</button>{error && <AuthError>{error}</AuthError>}</AuthCard></AuthPage>;
}
