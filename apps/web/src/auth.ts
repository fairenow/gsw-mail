export interface AuthSession {
  user: { id: string; email: string; name: string; emailVerified: boolean };
  session: { expiresAt: string };
}

export interface AccountContext {
  user: { id: string; email: string | null };
  workspaceMemberships: { id: string; name: string; role: "owner" | "admin" | "member"; status: string; setupStep: string | null; migratedFromExisting: boolean | null }[];
  mailboxMemberships: { id: string; address: string; displayName: string | null; role: "owner" | "delegate" | "read_only"; workspaceId: string; workspaceName: string; domain: string }[];
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

export function setPassword(password: string): Promise<unknown> {
  return authRequest("/set-password", { newPassword: password });
}

export async function logout(): Promise<void> {
  await authRequest("/sign-out", {}).catch(() => undefined);
  window.dispatchEvent(new Event("gsw-auth-change"));
}
