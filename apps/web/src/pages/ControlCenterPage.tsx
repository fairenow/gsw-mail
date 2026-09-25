import { useEffect, useMemo, useState } from "react";
import { completeMailboxSetup, getAccountContext, requestMailboxSetup, type AccountContext } from "../auth";
import { logout } from "../auth";
import { AuthCard } from "../components/auth/AuthCard";
import { AuthPage } from "../components/auth/AuthPage";
import { BrandMark } from "../components/auth/BrandMark";

export function ControlCenterPage() {
  const [context, setContext] = useState<AccountContext | null>(null);
  const [setupMailbox, setSetupMailbox] = useState<AccountContext["managedMailboxes"][number] | null>(null);
  const [setupAction, setSetupAction] = useState<"setup" | "reset">("setup");
  const [setupCode, setSetupCode] = useState("");
  const [setupPassword, setSetupPassword] = useState("");
  const [setupConfirm, setSetupConfirm] = useState("");
  const [setupMessage, setSetupMessage] = useState("");
  const [setupBusy, setSetupBusy] = useState(false);

  useEffect(() => { void getAccountContext().then(setContext).catch(() => undefined); }, []);

  const managedDomains = useMemo(() => {
    if (!context) return [];
    return [...new Set(context.managedMailboxes.map((mailbox) => mailbox.address.split("@")[1]).filter((value): value is string => Boolean(value)))];
  }, [context]);

  if (!context) return <AuthPage><AuthCard><p className="gsw-login-hint">Loading your control center…</p></AuthCard></AuthPage>;

  const workspace = context.workspaceMemberships[0];
  const adminEmail = context.user.email ?? "your verified admin email";

  const startMailboxSetup = async (mailbox: AccountContext["managedMailboxes"][number]) => {
    if (setupBusy) return;
    setSetupBusy(true);
    setSetupMessage("");
    setSetupCode("");
    setSetupPassword("");
    setSetupConfirm("");
    try {
      const result = await requestMailboxSetup(mailbox.id);
      setSetupMailbox(mailbox);
      setSetupAction(result.action);
      setSetupMessage(`A 6-digit verification code was sent to ${result.maskedRecoveryEmail}.`);
    } catch (error) {
      setSetupMessage(error instanceof Error ? error.message : "Could not send the admin verification code.");
    } finally {
      setSetupBusy(false);
    }
  };

  const finishMailboxSetup = async () => {
    if (!setupMailbox || setupBusy) return;
    if (setupCode.length !== 6 || setupPassword.length < 8 || setupPassword !== setupConfirm) {
      setSetupMessage("Enter the 6-digit code and matching password of at least 8 characters.");
      return;
    }
    setSetupBusy(true);
    try {
      await completeMailboxSetup(setupMailbox.id, setupCode, setupPassword);
      setSetupMessage(`${setupMailbox.address} login is ready. The mailbox can now sign in with its address and new password.`);
      setContext(await getAccountContext());
      setSetupMailbox(null);
      setSetupCode("");
      setSetupPassword("");
      setSetupConfirm("");
    } catch (error) {
      setSetupMessage(error instanceof Error ? error.message : "Could not finish mailbox login setup.");
    } finally {
      setSetupBusy(false);
    }
  };

  return <main className="gsw-control-center">
    <aside className="gsw-control-nav">
      <BrandMark size={54} />
      <p className="gsw-setup-kicker">GSW Admin</p>
      <h1>{workspace?.name ?? "Workspace"}</h1>
      <nav>
        <a className="is-active" href="#overview">Overview</a>
        <a href="#domains">Domains</a>
        <a href="#mailboxes">Mailboxes</a>
        <a href="#security">Security</a>
      </nav>
      <button className="gsw-btn gsw-btn-ghost" onClick={() => void logout()}>Sign out</button>
    </aside>

    <section className="gsw-control-main" id="overview">
      <header>
        <div>
          <p className="gsw-setup-kicker">Control center</p>
          <h2>{workspace?.name ?? "Guided Steps Wellness"}</h2>
          <p>{workspace?.role ?? "member"} · {adminEmail}</p>
        </div>
        <button className="gsw-btn gsw-btn-primary" onClick={() => window.location.assign("/mail")}>Open Mail</button>
      </header>

      <div className="gsw-control-stats">
        <div><strong>{managedDomains.length}</strong><span>Domains</span></div>
        <div><strong>{context.managedMailboxes.length}</strong><span>Mailboxes</span></div>
        <div><strong>{context.workspaceMemberships.length}</strong><span>Workspaces</span></div>
      </div>

      <div className="gsw-control-grid">
        <article id="domains">
          <h3>Domains</h3>
          <p>{managedDomains.length ? managedDomains.join(" · ") : "No domains connected"}</p>
          <span className="gsw-status-pill">{managedDomains.length ? "Connected" : "Needs setup"}</span>
        </article>

        <article id="mailboxes">
          <h3>Mailbox logins</h3>
          <p className="gsw-login-hint">Set or reset any mailbox password here. Verification codes are sent to the signed-in workspace admin email.</p>
          {context.managedMailboxes.length ? context.managedMailboxes.map((mailbox) => <div className="gsw-managed-mailbox" key={mailbox.id}>
            <p>{mailbox.address}<br /><small>{mailbox.authSetupStatus === "ready" ? "Login ready" : "Login setup required"}</small></p>
            <button className="gsw-btn gsw-btn-quiet" disabled={setupBusy} onClick={() => void startMailboxSetup(mailbox)}>
              {mailbox.authSetupStatus === "ready" ? "Reset login" : "Set up login"}
            </button>
          </div>) : <p>No mailboxes connected</p>}
          <span className="gsw-status-pill">{context.managedMailboxes.some((mailbox) => mailbox.authSetupStatus === "pending") ? "Setup required" : "Active"}</span>
        </article>

        <article>
          <h3>Setup</h3>
          <p>{context.onboardingComplete ? "Existing installation adopted" : "Workspace setup needs attention"}</p>
          <span className="gsw-status-pill">{context.onboardingComplete ? "Complete" : "In progress"}</span>
        </article>

        <article id="security">
          <h3>Admin verification</h3>
          <p>Mailbox setup and password resets are verified through <strong>{adminEmail}</strong>.</p>
          <span className="gsw-status-pill">OTP protected</span>
        </article>
      </div>

      {setupMessage && <p className="gsw-login-hint">{setupMessage}</p>}

      {setupMailbox && <div className="gsw-setup-inline">
        <p className="gsw-setup-kicker">Admin verified mailbox access</p>
        <h3>{setupAction === "reset" ? "Reset" : "Set up"} {setupMailbox.address}</h3>
        <p className="gsw-login-hint">Enter the 6-digit code sent to the workspace admin email, then choose the password this mailbox will use to sign in.</p>
        <label className="gsw-auth-field">Verification code<input autoComplete="one-time-code" inputMode="numeric" maxLength={6} value={setupCode} onChange={(event) => setSetupCode(event.target.value.replace(/\D/g, "").slice(0, 6))} /></label>
        <label className="gsw-auth-field">New password<input autoComplete="new-password" type="password" value={setupPassword} onChange={(event) => setSetupPassword(event.target.value)} /></label>
        <label className="gsw-auth-field">Confirm password<input autoComplete="new-password" type="password" value={setupConfirm} onChange={(event) => setSetupConfirm(event.target.value)} /></label>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button className="gsw-btn gsw-btn-primary" disabled={setupBusy} onClick={() => void finishMailboxSetup()}>{setupBusy ? "Saving…" : setupAction === "reset" ? "Reset mailbox login" : "Finish setup"}</button>
          <button className="gsw-btn gsw-btn-ghost" disabled={setupBusy} onClick={() => void startMailboxSetup(setupMailbox)}>Send a new code</button>
          <button className="gsw-btn gsw-btn-ghost" disabled={setupBusy} onClick={() => setSetupMailbox(null)}>Cancel</button>
        </div>
      </div>}
    </section>
  </main>;
}
