const issuer = "https://mx1.guidedstepswellness.com";
const clientId = "gsw-mail-web";
const redirectUri = `${window.location.origin}/auth/callback`;
const transactionKey = "gsw_oauth_transaction";
const tokenKey = "gsw_access_token";
const expiryKey = "gsw_token_expiry";

export function logout() {
  sessionStorage.removeItem(tokenKey);
  sessionStorage.removeItem(expiryKey);
  sessionStorage.removeItem(transactionKey);
  window.dispatchEvent(new Event("gsw-auth-change"));
}

export function accessToken(): string | null {
  const expires = Number(sessionStorage.getItem(expiryKey));
  return expires > Date.now() ? sessionStorage.getItem(tokenKey) : null;
}

const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export async function signIn(options: { forceLogin?: boolean } = {}) {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const state = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  sessionStorage.setItem(transactionKey, JSON.stringify({ verifier, state, created: Date.now() }));
  const url = new URL(`${issuer}/login`);
  const params = { response_type: "code", client_id: clientId, redirect_uri: redirectUri, scope: "openid urn:ietf:params:oauth:scope:mail", state, code_challenge: challenge, code_challenge_method: "S256" };
  if (options.forceLogin) Object.assign(params, { prompt: "login" });
  url.search = new URLSearchParams(params).toString();
  window.location.assign(url);
}

let callback: Promise<void> | undefined;
export function finishSignIn(): Promise<void> {
  return callback ??= exchangeCode();
}

async function exchangeCode() {
  const params = new URLSearchParams(window.location.search);
  window.history.replaceState(null, "", "/");
  const stored = sessionStorage.getItem(transactionKey);
  sessionStorage.removeItem(transactionKey);
  if (!stored) throw new Error("Sign-in session missing. Please sign in again.");
  const transaction = JSON.parse(stored);
  if (!transaction.state || params.get("state") !== transaction.state || typeof transaction.created !== "number" || Date.now() - transaction.created > 600000 || typeof transaction.verifier !== "string") throw new Error("Sign-in session invalid or expired. Please try again.");
  if (params.has("iss") && params.get("iss") !== issuer) throw new Error("Unexpected sign-in issuer.");
  if (params.has("error") || !params.get("code")) throw new Error("Sign-in was not completed. Please try again.");
  const response = await fetch("/auth/exchange", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: params.get("code"), codeVerifier: transaction.verifier, redirectUri }),
    redirect: "error",
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error("Could not complete sign-in. Please try again.");
  const result = await response.json();
  if (typeof result.access_token !== "string" || !result.access_token || typeof result.token_type !== "string" || result.token_type.toLowerCase() !== "bearer" || typeof result.expires_in !== "number" || !Number.isFinite(result.expires_in) || result.expires_in <= 0) throw new Error("Invalid sign-in response.");
  sessionStorage.setItem(tokenKey, result.access_token);
  sessionStorage.setItem(expiryKey, String(Date.now() + result.expires_in * 1000));
  window.dispatchEvent(new Event("gsw-auth-change"));
}
