import { useEffect, useMemo, useState } from "react";
import { completeMailboxSetup, getAccountContext, requestMailboxSetup, type AccountContext } from "../auth";
import { logout } from "../auth";
import { DomainAdminPanel } from "../components/admin/DomainAdminPanel";
import { AuthCard } from "../components/auth/AuthCard";
import { AuthPage } from "../components/auth/AuthPage";
import { BrandMark } from "../components/auth/BrandMark";

type ControlSection = "overview" | "domains" | "mailboxes" | "users" | "security";
type AdminSummary = {
  organizationId: string;
  domains: { id: string; name: string; status: "pending" | "verified" | "failed"; mxStatus: string; spfStatus: string; dkimStatus: string; dmarcStatus: string; dkimSelector: string | null; updatedAt: string }[];
  users: {
    membershipId: string; userId: string; name: string | null; email: string; emailVerified: boolean; userStatus: string;
    role: "owner" | "admin" | "member"; membershipStatus: string; lastLoginAt: string | null; authEmail: string | null;
    authEmailVerified: boolean | null; mailboxAccess: { accountId: string; address: string; role: string }[];
  }[];
  mailboxes: { id: string; address: string; displayName: string | null; status: string; authSetupStatus: "pending" | "ready"; userId: string | null; usedBytes: number; quotaBytes: number | null; accessCount: number }[];
  recoveryAdmin: { email: string; emailVerified: boolean; name: string } | null;
  recentAudit: { id: string; actorUserId: string | null; action: string; resourceType: string; resourceId: string | null; metadata: unknown; createdAt: string }[];
};

const sectionFromHash = (): ControlSection => {
  const value = window.location.hash.replace(/^#/, "");
  return value === "domains" || value === "mailboxes" || value === "users" || value === "security" ? value : "overview";
};

function humanStatus(value: string) { return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function statusTone(value: string) { return value === "verified" || value === "ready" || value === "active" ? "good" : value === "failed" || value === "disabled" || value === "suspended" ? "bad" : "warn"; }
function formatBytes(value: number) { if (!value) return "0 B"; const units = ["B", "KB", "MB", "GB", "TB"]; const power = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1); return `${(value / 1024 ** power).toFixed(power > 1 ? 1 : 0)} ${units[power]}`; }
function formatDate(value: string | null) { if (!value) return "Never"; return new Date(value).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); }

export function ControlCenterPage() {
  const [context, setContext] = useState<AccountContext | null>(null);
  const [admin, setAdmin] = useState<AdminSummary | null>(null);
  const [adminError, setAdminError] = useState("");
  const [section, setSection] = useState<ControlSection>(() => sectionFromHash());
  const [setupMailbox, setSetupMailbox] = useState<AccountContext["managedMailboxes"][number] | null>(null);
  const [setupAction, setSetupAction] = useState<"setup" | "reset">("setup");
  const [setupCode, setSetupCode] = useState("");
  const [setupPassword, setSetupPassword] = useState("");
  const [setupConfirm, setSetupConfirm] = useState("");
  const [setupMessage, setSetupMessage] = useState("");
  const [setupBusy, setSetupBusy] = useState(false);

  useEffect(() => { void getAccountContext().then(setContext).catch(() => undefined); }, []);
  useEffect(() => { const onHash = () => setSection(sectionFromHash()); window.addEventListener("hashchange", onHash); return () => window.removeEventListener("hashchange", onHash); }, []);

  const workspace = context?.workspaceMemberships[0];

  useEffect(() => {
    if (!workspace?.id) return;
    let active = true;
    setAdminError("");
    fetch(`/admin/control-center?organizationId=${encodeURIComponent(workspace.id)}`, { credentials: "include", signal: AbortSignal.timeout(15000) })
      .then(async (response) => { const result = await response.json(); if (!response.ok) throw new Error(result.error ?? "Could not load workspace administration."); if (active) setAdmin(result as AdminSummary); })
      .catch((error) => { if (active) setAdminError(error instanceof Error ? error.message : "Could not load workspace administration."); });
    return () => { active = false; };
  }, [workspace?.id]);

  const managedDomains = useMemo(() => {
    if (admin?.domains.length) return admin.domains.map((domain) => domain.name);
    if (!context) return [];
    return [...new Set(context.managedMailboxes.map((mailbox) => mailbox.address.split("@")[1]).filter((value): value is string => Boolean(value)))];
  }, [admin, context]);

  if (!context) return <AuthPage><AuthCard><p className="gsw-login-hint">Loading your control center…</p></AuthCard></AuthPage>;

  const adminEmail = context.user.email ?? "your verified admin email";
  const pendingMailboxes = context.managedMailboxes.filter((mailbox) => mailbox.authSetupStatus === "pending").length;
  const navigate = (next: ControlSection) => { setSection(next); window.history.replaceState(null, "", `${window.location.pathname}#${next}`); };
  const reloadAdmin = async () => {
    if (!workspace?.id) return;
    const response = await fetch(`/admin/control-center?organizationId=${encodeURIComponent(workspace.id)}`, { credentials: "include", signal: AbortSignal.timeout(15000) });
    const result = await response.json(); if (!response.ok) throw new Error(result.error ?? "Could not refresh workspace administration."); setAdmin(result as AdminSummary);
  };

  const startMailboxSetup = async (mailbox: AccountContext["managedMailboxes"][number]) => {
    if (setupBusy) return;
    setSetupBusy(true); setSetupMessage(""); setSetupCode(""); setSetupPassword(""); setSetupConfirm("");
    try { const result = await requestMailboxSetup(mailbox.id); setSetupMailbox(mailbox); setSetupAction(result.action); setSetupMessage(`A 6-digit verification code was sent to ${result.maskedRecoveryEmail}.`); }
    catch (error) { setSetupMessage(error instanceof Error ? error.message : "Could not send the admin verification code."); }
    finally { setSetupBusy(false); }
  };

  const finishMailboxSetup = async () => {
    if (!setupMailbox || setupBusy) return;
    if (setupCode.length !== 6 || setupPassword.length < 8 || setupPassword !== setupConfirm) { setSetupMessage("Enter the 6-digit code and matching password of at least 8 characters."); return; }
    setSetupBusy(true);
    try {
      await completeMailboxSetup(setupMailbox.id, setupCode, setupPassword);
      setSetupMessage(`${setupMailbox.address} login is ready. The mailbox can now sign in with its address and new password.`);
      setContext(await getAccountContext()); await reloadAdmin().catch(() => undefined); setSetupMailbox(null); setSetupCode(""); setSetupPassword(""); setSetupConfirm("");
    } catch (error) { setSetupMessage(error instanceof Error ? error.message : "Could not finish mailbox login setup."); }
    finally { setSetupBusy(false); }
  };

  const navButton = (id: ControlSection, label: string, note?: string) => <button className={section === id ? "is-active" : ""} onClick={() => navigate(id)}><span>{label}</span>{note ? <small>{note}</small> : null}</button>;

  return <main className="gsw-control-center">
    <aside className="gsw-control-nav">
      <BrandMark size={54} /><p className="gsw-setup-kicker">GSW Admin</p><h1>{workspace?.name ?? "Workspace"}</h1>
      <nav>
        {navButton("overview", "Overview")}
        {navButton("domains", "Domains", admin?.domains.some((domain) => domain.status !== "verified") ? "Needs attention" : undefined)}
        {navButton("mailboxes", "Mailboxes", pendingMailboxes ? `${pendingMailboxes} to finish` : undefined)}
        {navButton("users", "Users", admin ? String(admin.users.length) : undefined)}
        {navButton("security", "Security")}
        <button className="is-disabled" disabled><span>Billing</span><small>Coming soon</small></button>
        <button className="is-disabled" disabled><span>Settings</span><small>Coming soon</small></button>
      </nav>
      <button className="gsw-btn gsw-btn-ghost" onClick={() => void logout()}>Sign out</button>
    </aside>

    <section className="gsw-control-main">
      <header><div><p className="gsw-setup-kicker">Control center</p><h2>{workspace?.name ?? "Guided Steps Wellness"}</h2><p>{workspace?.role ?? "member"} · {adminEmail}</p></div><button className="gsw-btn gsw-btn-primary" onClick={() => window.location.assign("/mail")}>Open Mail</button></header>
      {adminError && <div className="gsw-control-alert"><strong>Some admin details could not load.</strong><span>{adminError}</span></div>}

      {section === "overview" && <>
        <div className="gsw-control-stats">
          <button onClick={() => navigate("domains")}><strong>{managedDomains.length}</strong><span>Domains</span><small>{admin?.domains.some((domain) => domain.status !== "verified") ? "Review DNS readiness" : "All ready"}</small></button>
          <button onClick={() => navigate("mailboxes")}><strong>{context.managedMailboxes.length}</strong><span>Mailboxes</span><small>{pendingMailboxes ? `${pendingMailboxes} need login setup` : "All logins ready"}</small></button>
          <button onClick={() => navigate("users")}><strong>{admin?.users.length ?? context.workspaceMemberships.length}</strong><span>Users</span><small>Workspace access</small></button>
        </div>
        <div className="gsw-control-grid">
          <article className="gsw-control-action-card"><p className="gsw-setup-kicker">Mailbox readiness</p><h3>{pendingMailboxes ? `${pendingMailboxes} mailbox${pendingMailboxes === 1 ? "" : "es"} need attention` : "All mailbox logins are ready"}</h3><p>{pendingMailboxes ? "Finish login setup so each mailbox can sign in independently." : "Passwords can be reset securely from the Mailboxes section using admin OTP verification."}</p><button className="gsw-btn gsw-btn-quiet" onClick={() => navigate("mailboxes")}>{pendingMailboxes ? "Finish mailbox setup" : "Manage mailboxes"}</button></article>
          <article className="gsw-control-action-card"><p className="gsw-setup-kicker">Domain readiness</p><h3>{admin?.domains.length ? admin.domains.map((domain) => domain.name).join(" · ") : managedDomains.join(" · ") || "No domain connected"}</h3><p>{admin?.domains.some((domain) => domain.status !== "verified") ? "One or more domains still need public DNS verification." : "Every connected mail domain currently passes the required DNS checks."}</p><button className="gsw-btn gsw-btn-quiet" onClick={() => navigate("domains")}>Manage domains</button></article>
          <article className="gsw-control-action-card"><p className="gsw-setup-kicker">Account recovery</p><h3>{admin?.recoveryAdmin?.email ?? adminEmail}</h3><p>This verified workspace owner identity is used to recover mailbox credentials when mailbox access itself is unavailable.</p><button className="gsw-btn gsw-btn-quiet" onClick={() => navigate("security")}>Review security</button></article>
          <article className="gsw-control-action-card"><p className="gsw-setup-kicker">Workspace access</p><h3>{admin?.users.filter((user) => user.membershipStatus === "active").length ?? 1} active user{(admin?.users.filter((user) => user.membershipStatus === "active").length ?? 1) === 1 ? "" : "s"}</h3><p>See who belongs to the workspace, their role, and every mailbox they can access.</p><button className="gsw-btn gsw-btn-quiet" onClick={() => navigate("users")}>Review users</button></article>
        </div>
      </>}

      {section === "domains" && workspace?.id && <DomainAdminPanel organizationId={workspace.id} />}

      {section === "mailboxes" && <section className="gsw-control-section">
        <div className="gsw-control-section-head"><div><p className="gsw-setup-kicker">Mailboxes</p><h3>Mailbox administration</h3><p>Set up or reset mailbox logins. Verification is sent to the workspace admin recovery email.</p></div></div>
        <div className="gsw-admin-list">
          {context.managedMailboxes.length ? context.managedMailboxes.map((mailbox) => { const details = admin?.mailboxes.find((item) => item.id === mailbox.id); return <article className="gsw-admin-list-row" key={mailbox.id}><div className="gsw-admin-primary"><strong>{mailbox.address}</strong><span>{mailbox.displayName ?? "Mailbox"}</span></div><div className="gsw-admin-meta"><span className={`gsw-status-pill tone-${statusTone(mailbox.authSetupStatus)}`}>{mailbox.authSetupStatus === "ready" ? "Login ready" : "Setup required"}</span><small>{details?.accessCount ?? 0} user{(details?.accessCount ?? 0) === 1 ? "" : "s"} with access</small>{details ? <small>{formatBytes(details.usedBytes)} used{details.quotaBytes ? ` of ${formatBytes(details.quotaBytes)}` : ""}</small> : null}</div><button className="gsw-btn gsw-btn-quiet" disabled={setupBusy} onClick={() => void startMailboxSetup(mailbox)}>{mailbox.authSetupStatus === "ready" ? "Reset login" : "Set up login"}</button></article>; }) : <div className="gsw-control-empty">No mailboxes connected.</div>}
        </div>
      </section>}

      {section === "users" && <section className="gsw-control-section">
        <div className="gsw-control-section-head"><div><p className="gsw-setup-kicker">Users</p><h3>People & mailbox access</h3><p>Admins are represented as workspace roles here instead of a separate administration page.</p></div></div>
        {admin ? <div className="gsw-user-grid">{admin.users.map((user) => <article className="gsw-user-card" key={user.membershipId}><div className="gsw-control-row-head"><div><h4>{user.name || user.email}</h4><p>{user.authEmail || user.email}</p></div><span className={`gsw-role-pill role-${user.role}`}>{humanStatus(user.role)}</span></div><div className="gsw-user-facts"><span><strong>Status</strong>{humanStatus(user.membershipStatus)}</span><span><strong>Verified</strong>{user.authEmailVerified || user.emailVerified ? "Yes" : "No"}</span><span><strong>Last login</strong>{formatDate(user.lastLoginAt)}</span></div><div className="gsw-access-block"><strong>Mailbox access</strong>{user.mailboxAccess.length ? user.mailboxAccess.map((access) => <div key={`${user.userId}-${access.accountId}`}><span>{access.address}</span><small>{humanStatus(access.role)}</small></div>) : <p>No mailbox access assigned.</p>}</div></article>)}</div> : <div className="gsw-control-empty">Loading workspace users…</div>}
      </section>}

      {section === "security" && <section className="gsw-control-section">
        <div className="gsw-control-section-head"><div><p className="gsw-setup-kicker">Security</p><h3>Recovery & recent activity</h3><p>Keep the workspace recoverable even if an individual mailbox cannot receive mail.</p></div></div>
        <div className="gsw-security-grid"><article className="gsw-security-card"><span className="gsw-security-icon">✓</span><div><strong>Workspace recovery email</strong><h4>{admin?.recoveryAdmin?.email ?? adminEmail}</h4><p>{admin?.recoveryAdmin?.emailVerified === false ? "Verification required" : "Verified workspace owner identity"}</p></div></article><article className="gsw-security-card"><span className="gsw-security-icon">#</span><div><strong>Mailbox credential recovery</strong><h4>6-digit OTP</h4><p>Codes expire after 10 minutes and are limited to five attempts.</p></div></article></div>
        <div className="gsw-audit-card"><div className="gsw-control-row-head"><div><h4>Recent security & admin activity</h4><p>Most recent workspace audit events.</p></div></div>{admin?.recentAudit.length ? admin.recentAudit.map((event) => <div className="gsw-audit-row" key={event.id}><div><strong>{humanStatus(event.action)}</strong><span>{humanStatus(event.resourceType)}{event.resourceId ? ` · ${event.resourceId.slice(0, 8)}` : ""}</span></div><time>{formatDate(event.createdAt)}</time></div>) : <p className="gsw-control-note">No recent audit events are available yet.</p>}</div>
      </section>}

      {setupMessage && <p className="gsw-control-message">{setupMessage}</p>}
      {setupMailbox && <div className="gsw-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !setupBusy) setSetupMailbox(null); }}><div className="gsw-control-modal" role="dialog" aria-modal="true" aria-labelledby="mailbox-setup-title"><p className="gsw-setup-kicker">Admin verified mailbox access</p><h3 id="mailbox-setup-title">{setupAction === "reset" ? "Reset" : "Set up"} {setupMailbox.address}</h3><p className="gsw-login-hint">Enter the 6-digit code sent to the workspace admin email, then choose the password this mailbox will use to sign in.</p><label className="gsw-auth-field">Verification code<input autoComplete="one-time-code" inputMode="numeric" maxLength={6} value={setupCode} onChange={(event) => setSetupCode(event.target.value.replace(/\D/g, "").slice(0, 6))} /></label><label className="gsw-auth-field">New password<input autoComplete="new-password" type="password" value={setupPassword} onChange={(event) => setSetupPassword(event.target.value)} /></label><label className="gsw-auth-field">Confirm password<input autoComplete="new-password" type="password" value={setupConfirm} onChange={(event) => setSetupConfirm(event.target.value)} /></label><div className="gsw-control-modal-actions"><button className="gsw-btn gsw-btn-primary" disabled={setupBusy} onClick={() => void finishMailboxSetup()}>{setupBusy ? "Saving…" : setupAction === "reset" ? "Reset mailbox login" : "Finish setup"}</button><button className="gsw-btn gsw-btn-ghost" disabled={setupBusy} onClick={() => void startMailboxSetup(setupMailbox)}>Send a new code</button><button className="gsw-btn gsw-btn-ghost" disabled={setupBusy} onClick={() => setSetupMailbox(null)}>Cancel</button></div></div></div>}
    </section>
  </main>;
}
