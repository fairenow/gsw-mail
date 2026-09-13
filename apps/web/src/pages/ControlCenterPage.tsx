import { useEffect, useState } from "react";
import { getAccountContext, type AccountContext } from "../auth";
import { logout } from "../auth";
import { AuthCard } from "../components/auth/AuthCard";
import { AuthPage } from "../components/auth/AuthPage";
import { BrandMark } from "../components/auth/BrandMark";

export function ControlCenterPage() {
  const [context, setContext] = useState<AccountContext | null>(null);
  useEffect(() => { void getAccountContext().then(setContext).catch(() => undefined); }, []);
  if (!context) return <AuthPage><AuthCard><p className="gsw-login-hint">Loading your control center…</p></AuthCard></AuthPage>;
  const workspace = context.workspaceMemberships[0];
  const domains = new Set(context.mailboxMemberships.map((mailbox) => mailbox.domain));
  return <main className="gsw-control-center">
    <aside className="gsw-control-nav"><BrandMark size={54} /><p className="gsw-setup-kicker">GSW Admin</p><h1>{workspace?.name ?? "Workspace"}</h1><nav><a className="is-active" href="/control-center">Overview</a><a href="/setup">Domains</a><a href="/setup">Mailboxes</a><a href="/setup">Users</a><a href="/setup">Admins</a><a href="/setup">Billing</a><a href="/setup">Security</a><a href="/setup">Settings</a></nav><button className="gsw-btn gsw-btn-ghost" onClick={() => void logout()}>Sign out</button></aside>
    <section className="gsw-control-main"><header><div><p className="gsw-setup-kicker">Control center</p><h2>{workspace?.name ?? "Guided Steps Wellness"}</h2><p>{workspace?.role ?? "member"} · {context.user.email}</p></div><button className="gsw-btn gsw-btn-primary" onClick={() => window.location.assign("/mail")}>Open Mail</button></header><div className="gsw-control-stats"><div><strong>{domains.size}</strong><span>Domains</span></div><div><strong>{context.managedMailboxes.length}</strong><span>Mailboxes</span></div><div><strong>{context.workspaceMemberships.length}</strong><span>Workspaces</span></div></div><div className="gsw-control-grid"><article><h3>Domains</h3><p>{domains.size ? [...domains].join(" · ") : "No domains connected"}</p><span className="gsw-status-pill">{domains.size ? "Connected" : "Needs setup"}</span></article><article><h3>Mailboxes</h3><p>{context.managedMailboxes.length ? context.managedMailboxes.map((mailbox) => `${mailbox.address} · ${mailbox.authUserId ? "Login ready" : "Login setup required"}`).join("\n") : "No mailboxes connected"}</p><span className="gsw-status-pill">{context.managedMailboxes.some((mailbox) => !mailbox.authUserId) ? "Setup required" : "Active"}</span></article><article><h3>Setup</h3><p>{context.onboardingComplete ? "Existing installation adopted" : "Workspace setup needs attention"}</p><span className="gsw-status-pill">{context.onboardingComplete ? "Complete" : "In progress"}</span></article><article><h3>Mailbox access</h3><p>{context.mailboxMemberships.length ? "Explicit memberships only" : "Control identity has no mailbox content access"}</p><span className="gsw-status-pill">Secure</span></article></div></section>
  </main>;
}
