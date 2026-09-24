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

export class AccountContextError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "AccountContextError";
  }
}

async function authRequest<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/auth${path}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "content-type": "application/json" } : undefined,
    credentials: "include",
    signal: AbortSignal.timeout(15000),
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.message ?? result.error ?? "Authentication request failed.");
  return result as T;
}

function currentOAuthQuery(): string | undefined {
  const value = new URLSearchParams(window.location.search).get("oauth_query")?.trim();
  return value || undefined;
}

function withOAuthQuery<T extends Record<string, unknown>>(body: T): T & { oauth_query?: string } {
  const oauthQuery = currentOAuthQuery();
  return oauthQuery ? { ...body, oauth_query: oauthQuery } : body;
}

type OAuthContinuation = { redirect?: boolean; url?: string };
export interface SignInResult { continuedOAuth: boolean }

function continueOAuth(result: OAuthContinuation): boolean {
  if (result.redirect === false || typeof result.url !== "string" || !result.url) return false;
  window.location.assign(result.url);
  return true;
}

export function getSession(): Promise<AuthSession | null> {
  return authRequest<AuthSession | null>("/get-session?disableCookieCache=true");
}

export function getAccountContext(): Promise<AccountContext> {
  return fetch("/api/account/context", { credentials: "include", signal: AbortSignal.timeout(15000) }).then(async (response) => {
    const result = await response.json();
    if (!response.ok) throw new AccountContextError(result.error ?? "Could not load account context.", response.status);
    return result as AccountContext;
  });
}

export async function resolveAccountContext(): Promise<AccountContext> {
  let lastError: unknown;
  for (const delay of [0, 250, 750]) {
    if (delay) await new Promise((resolve) => window.setTimeout(resolve, delay));
    try {
      return await getAccountContext();
    } catch (error) {
      lastError = error;
      if (!(error instanceof AccountContextError) || ![409, 503].includes(error.status)) throw error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Could not resolve account context.");
}

export function requestOneTimeCode(email: string): Promise<unknown> {
  return authRequest("/email-otp/send-verification-otp", { email, type: "sign-in" });
}

export async function signInWithPassword(email: string, password: string): Promise<SignInResult> {
  const result = await authRequest<OAuthContinuation>("/sign-in/email", withOAuthQuery({ email, password }));
  return { continuedOAuth: continueOAuth(result) };
}

export async function signInWithCode(email: string, otp: string, name?: string): Promise<SignInResult> {
  const result = await authRequest<OAuthContinuation>("/sign-in/email-otp", withOAuthQuery({ email, otp, ...(name ? { name } : {}) }));
  return { continuedOAuth: continueOAuth(result) };
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
