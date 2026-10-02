export interface AuthSession {
  user: { id: string; email: string; name: string; emailVerified: boolean; image?: string | null };
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
  // Better Auth signs the provider-owned query before redirecting into custom
  // OAuth pages. Hash fragments are intentionally excluded so GSW can use them
  // for presentation-only state such as "use another account" without adding
  // anything to the signed OAuth transaction.
  const value = window.location.search.replace(/^\?/, "").trim();
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

export interface OAuthPublicClient {
  client_id: string;
  client_name?: string | null;
  client_uri?: string | null;
  logo_uri?: string | null;
  policy_uri?: string | null;
  tos_uri?: string | null;
}

export interface OAuthConsentResult {
  redirect?: boolean;
  url?: string;
}

export interface DeviceSession {
  session: {
    token: string;
    expiresAt: string;
    userId?: string;
  };
  user: {
    id: string;
    email: string;
    name: string;
    image?: string | null;
  };
}

export function getSession(): Promise<AuthSession | null> {
  return authRequest<AuthSession | null>("/get-session?disableCookieCache=true");
}

export function listDeviceSessions(): Promise<DeviceSession[]> {
  return authRequest<DeviceSession[]>("/multi-session/list-device-sessions");
}

export function setActiveDeviceSession(sessionToken: string): Promise<unknown> {
  return authRequest("/multi-session/set-active", { sessionToken });
}

export async function continueOAuthAfterAccountSelection(): Promise<void> {
  const result = await authRequest<OAuthContinuation>("/oauth2/continue", withOAuthQuery({ selected: true }));
  if (!continueOAuth(result)) throw new Error("The OAuth account selection could not be continued.");
}

export function getOAuthPublicClient(clientId: string): Promise<OAuthPublicClient> {
  return authRequest<OAuthPublicClient>(`/oauth2/public-client?client_id=${encodeURIComponent(clientId)}`);
}

export async function submitOAuthConsent(accept: boolean, acceptedScope?: string): Promise<void> {
  // Better Auth binds this decision to its signed pending-consent transaction.
  // Keep the signed oauth_query intact through the consent decision instead of
  // rebuilding authorization state from client-visible fields.
  const result = await authRequest<OAuthConsentResult>("/oauth2/consent", withOAuthQuery({
    accept,
    ...(accept && acceptedScope ? { scope: acceptedScope } : {}),
  }));
  if (result.redirect !== false && typeof result.url === "string" && result.url) {
    window.location.assign(result.url);
    return;
  }
  throw new Error("The authorization request could not be completed.");
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

export interface MailboxSetupRequest {
  sent: true;
  action: "setup" | "reset";
  recoveryEmail: string;
  maskedRecoveryEmail: string;
  address: string;
}

export function requestMailboxSetup(accountId: string): Promise<MailboxSetupRequest> {
  return fetch(`/api/mailboxes/${accountId}/setup`, { method: "POST", credentials: "include" }).then(async (response) => { const result = await response.json(); if (!response.ok) throw new Error(result.message ?? result.error ?? "Could not send mailbox setup code."); return result as MailboxSetupRequest; });
}

export function completeMailboxSetup(accountId: string, code: string, password: string): Promise<unknown> {
  return fetch(`/api/mailboxes/${accountId}/setup/complete`, { method: "POST", headers: { "content-type": "application/json" }, credentials: "include", body: JSON.stringify({ code, password }) }).then(async (response) => { const result = await response.json(); if (!response.ok) throw new Error(result.message ?? result.error ?? "Could not set up mailbox login."); return result; });
}

export function setPassword(password: string): Promise<unknown> {
  return fetch("/api/account/set-password", {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
    signal: AbortSignal.timeout(15000),
    body: JSON.stringify({ newPassword: password }),
  }).then(async (response) => {
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.message ?? result.error ?? "Could not set password.");
    return result;
  });
}

export function requestAccountDeletion(): Promise<unknown> {
  return authRequest("/delete-user", { callbackURL: `${window.location.origin}/account-deleted` });
}

export async function logout(): Promise<void> {
  await authRequest("/sign-out", {}).catch(() => undefined);
  window.dispatchEvent(new Event("gsw-auth-change"));
}
