export interface AuthSession {
  user: { id: string; email: string; name: string; emailVerified: boolean };
  session: { expiresAt: string };
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

export function requestSignUp(email: string, name: string): Promise<unknown> {
  return authRequest("/sign-in/magic-link", { email, name, newUserCallbackURL: `${window.location.origin}/create-password`, callbackURL: `${window.location.origin}/` });
}

export function signInWithPassword(email: string, password: string): Promise<unknown> {
  return authRequest("/sign-in/email", { email, password });
}

export function requestSignInLink(email: string): Promise<unknown> {
  return authRequest("/sign-in/magic-link", { email, callbackURL: `${window.location.origin}/` });
}

export function setPassword(password: string): Promise<unknown> {
  return authRequest("/set-password", { newPassword: password });
}

export async function logout(): Promise<void> {
  await authRequest("/sign-out", {}).catch(() => undefined);
  window.dispatchEvent(new Event("gsw-auth-change"));
}
