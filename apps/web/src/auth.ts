export interface AuthSession {
  user: { id: string; email: string; name: string; emailVerified: boolean };
  session: { expiresAt: string };
}

export interface AccountContext {
  user: { id: string; email: string | null };
  workspaceMemberships: { id: string; name: string; role: "owner" | "admin" | "member"; status: string; setupStep: string | null; migratedFromExisting: boolean | null }[];
  mailboxMemberships: { id: string; address: string; displayName: string | null; role: "owner" | "delegate" | "read_only"; workspaceId: string; workspaceName: string; domain: string }[];
  managedMailboxes: { id: string; address: string; displayName: string | null; workspaceId: string; authUserId: string | null; authSetupStatus: "pending" | "ready"; status: string }[];
  onboardingComplete: boolean;
  defaultDestination: "setup" | "control-center" | "mail";
}

async function authRequest<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/auth${path}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "content-type": "application/json" } : undefined,
    credentials: "include",
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.message ?? result.error ?? "Authentication request failed.");
  return result as T;
}

export function getSession(): Promise<AuthSession | null> {
  return authRequest<AuthSession | null>("/get-session");
}

export function getAccountContext(): Promise<AccountContext> {
  return fetch("/api/account/context", { credentials: "include" }).then(async (response) => {
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "Could not load account context.");
    return result as AccountContext;
  });
}

export function requestOneTimeCode(email: string): Promise<unknown> {
  return authRequest("/email-otp/send-verification-otp", { email, type: "sign-in" });
}

export function signInWithPassword(email: string, password: string): Promise<unknown> {
  return authRequest("/sign-in/email", { email, password });
}

export function signInWithCode(email: string, otp: string, name?: string): Promise<unknown> {
  return authRequest("/sign-in/email-otp", { email, otp, ...(name ? { name } : {}) });
}

export interface PasswordResetRequest {
  success: true;
  recoveryType: "workspace-recovery" | "self";
  maskedRecoveryEmail: string;
  targetEmail: string;
}

export function requestPasswordResetCode(email: string): Promise<PasswordResetRequest> {
  return fetch("/api/account/request-password-reset", { method: "POST", headers: { "content-type": "application/json" }, credentials: "include", body: JSON.stringify({ email }) }).then(async (response) => { const result = await response.json(); if (!response.ok) throw new Error(result.message ?? result.error ?? "Could not send a reset code."); return result as PasswordResetRequest; });
}

export function resetPasswordWithCode(email: string, otp: string, password: string): Promise<unknown> {
  return fetch("/api/account/complete-password-reset", { method: "POST", headers: { "content-type": "application/json" }, credentials: "include", body: JSON.stringify({ email, otp, newPassword: password }) }).then(async (response) => { const result = await response.json(); if (!response.ok) throw new Error(result.message ?? result.error ?? "Could not reset your password."); return result; });
}

export function requestMailboxSetup(accountId: string): Promise<unknown> {
  return fetch(`/api/mailboxes/${accountId}/setup`, { method: "POST", credentials: "include" }).then(async (response) => { const result = await response.json(); if (!response.ok) throw new Error(result.error ?? "Could not send mailbox setup code."); return result; });
}

export function completeMailboxSetup(accountId: string, code: string, password: string): Promise<unknown> {
  return fetch(`/api/mailboxes/${accountId}/setup/complete`, { method: "POST", headers: { "content-type": "application/json" }, credentials: "include", body: JSON.stringify({ code, password }) }).then(async (response) => { const result = await response.json(); if (!response.ok) throw new Error(result.error ?? "Could not set up mailbox login."); return result; });
}

export function setPassword(password: string): Promise<unknown> {
  return authRequest("/set-password", { newPassword: password });
}

export async function logout(): Promise<void> {
  await authRequest("/sign-out", {}).catch(() => undefined);
  window.dispatchEvent(new Event("gsw-auth-change"));
}
