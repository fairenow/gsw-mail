import { useEffect, useState } from "react";
import { BrandMark } from "../components/auth/BrandMark";

const CLIENT_ID = "gsw-mail-web-oauth-test";
const SCOPES = "openid profile email";
const STORAGE_KEY = "gsw-oauth-test-transaction";

type Discovery = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
  jwks_uri: string;
};

type TokenResponse = {
  access_token: string;
  id_token?: string;
};

type OAuthTransaction = {
  state: string;
  nonce: string;
  verifier: string;
  redirectUri: string;
};

type VerifiedIdentity = {
  name?: string;
  email?: string;
  picture?: string;
};

type SigningJwk = JsonWebKey & { kid?: string };

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4 || 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function randomValue(bytes = 32): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

async function getDiscovery(): Promise<Discovery> {
  const response = await fetch("/api/auth/.well-known/openid-configuration", { credentials: "omit" });
  if (!response.ok) throw new Error("Could not load GSW sign-in.");
  const discovery = await response.json() as Discovery;
  for (const endpoint of [discovery.authorization_endpoint, discovery.token_endpoint, discovery.userinfo_endpoint, discovery.jwks_uri]) {
    if (new URL(endpoint).origin !== window.location.origin) throw new Error("GSW sign-in returned an unexpected host.");
  }
  return discovery;
}

function saveTransaction(transaction: OAuthTransaction): void {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(transaction));
}

function readTransaction(): OAuthTransaction {
  const raw = sessionStorage.getItem(STORAGE_KEY);
  if (!raw) throw new Error("This sign-in attempt has expired. Start again.");
  const transaction = JSON.parse(raw) as Partial<OAuthTransaction>;
  if (!transaction.state || !transaction.nonce || !transaction.verifier || !transaction.redirectUri) throw new Error("This sign-in attempt is incomplete. Start again.");
  return transaction as OAuthTransaction;
}

async function verifyIdToken(idToken: string, discovery: Discovery, expectedNonce: string): Promise<Record<string, unknown>> {
  const parts = idToken.split(".");
  if (parts.length !== 3) throw new Error("The GSW identity response was invalid.");
  const header = JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[0]))) as { alg?: string; kid?: string };
  const payload = JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[1]))) as Record<string, unknown>;
  if (header.alg !== "ES256" || !header.kid) throw new Error("The GSW identity response used an unexpected signing method.");

  const jwksResponse = await fetch(discovery.jwks_uri, { credentials: "omit" });
  if (!jwksResponse.ok) throw new Error("Could not verify the GSW identity response.");
  const jwks = await jwksResponse.json() as { keys?: SigningJwk[] };
  const key = jwks.keys?.find((candidate) => candidate.kid === header.kid);
  if (!key) throw new Error("Could not verify the GSW identity response.");
  const cryptoKey = await crypto.subtle.importKey("jwk", key, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  const signatureVerified = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    cryptoKey,
    Uint8Array.from(decodeBase64Url(parts[2])),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  if (!signatureVerified) throw new Error("Could not verify the GSW identity response.");
  if (payload.iss !== discovery.issuer) throw new Error("The GSW identity issuer did not match.");
  const audience = payload.aud;
  if (!(audience === CLIENT_ID || (Array.isArray(audience) && audience.includes(CLIENT_ID)))) throw new Error("The GSW identity response was not issued for this application.");
  if (payload.nonce !== expectedNonce) throw new Error("This sign-in attempt could not be matched.");
  if (typeof payload.exp !== "number" || payload.exp <= Math.floor(Date.now() / 1000)) throw new Error("This sign-in attempt has expired.");
  if (typeof payload.sub !== "string" || !payload.sub) throw new Error("The GSW identity response was incomplete.");
  return payload;
}

export function OAuthTestPage() {
  const path = window.location.pathname;
  const isCallback = path === "/oauth/test/callback";
  const autoLaunch = path === "/oauth/connect";
  const [busy, setBusy] = useState(autoLaunch || isCallback);
  const [error, setError] = useState("");
  const [identity, setIdentity] = useState<VerifiedIdentity | null>(null);

  const begin = async () => {
    setBusy(true);
    setError("");
    try {
      const discovery = await getDiscovery();
      const verifier = randomValue(48);
      const state = randomValue();
      const nonce = randomValue();
      const redirectUri = `${window.location.origin}/oauth/test/callback`;
      const challenge = await challengeFor(verifier);
      saveTransaction({ state, nonce, verifier, redirectUri });

      const authorize = new URL(discovery.authorization_endpoint);
      authorize.searchParams.set("response_type", "code");
      authorize.searchParams.set("client_id", CLIENT_ID);
      authorize.searchParams.set("redirect_uri", redirectUri);
      authorize.searchParams.set("scope", SCOPES);
      authorize.searchParams.set("state", state);
      authorize.searchParams.set("nonce", nonce);
      authorize.searchParams.set("code_challenge", challenge);
      authorize.searchParams.set("code_challenge_method", "S256");
      authorize.searchParams.set("prompt", "consent");
      window.location.assign(authorize.toString());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start GSW sign-in.");
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!autoLaunch) return;
    void begin();
  }, [autoLaunch]);

  useEffect(() => {
    if (!isCallback) return;
    let cancelled = false;
    void (async () => {
      try {
        const params = new URLSearchParams(window.location.search);
        const providerError = params.get("error");
        if (providerError) {
          const description = params.get("error_description");
          throw new Error(providerError === "access_denied" ? "You cancelled the GSW authorization request." : (description || "GSW sign-in could not be completed."));
        }

        const code = params.get("code");
        const returnedState = params.get("state");
        const transaction = readTransaction();
        if (!code || !returnedState || returnedState !== transaction.state) throw new Error("This sign-in attempt could not be verified. Start again.");

        const discovery = await getDiscovery();
        const tokenResponse = await fetch(discovery.token_endpoint, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          credentials: "omit",
          body: new URLSearchParams({
            grant_type: "authorization_code",
            client_id: CLIENT_ID,
            code,
            redirect_uri: transaction.redirectUri,
            code_verifier: transaction.verifier,
          }),
        });
        const tokens = await tokenResponse.json() as TokenResponse & { error?: string; error_description?: string };
        if (!tokenResponse.ok || !tokens.access_token || !tokens.id_token) throw new Error(tokens.error_description || tokens.error || "GSW sign-in could not be completed.");

        const claims = await verifyIdToken(tokens.id_token, discovery, transaction.nonce);
        const userInfoResponse = await fetch(discovery.userinfo_endpoint, {
          headers: { authorization: `Bearer ${tokens.access_token}` },
          credentials: "omit",
        });
        if (!userInfoResponse.ok) throw new Error("Could not load your GSW profile.");
        const userInfo = await userInfoResponse.json() as Record<string, unknown>;
        if (typeof userInfo.sub !== "string" || userInfo.sub !== claims.sub) throw new Error("The GSW profile did not match this sign-in.");

        const productResponse = await fetch("/api/account/diagnostics", {
          headers: { authorization: `Bearer ${tokens.access_token}` },
          credentials: "omit",
        });
        if (productResponse.status !== 401) throw new Error("This identity connection requested more access than expected.");

        if (!cancelled) {
          setIdentity({
            name: typeof userInfo.name === "string" ? userInfo.name : undefined,
            email: typeof userInfo.email === "string" ? userInfo.email : undefined,
            picture: typeof userInfo.picture === "string" ? userInfo.picture : undefined,
          });
          sessionStorage.removeItem(STORAGE_KEY);
          window.history.replaceState({}, "", "/oauth/test/callback");
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "GSW sign-in could not be completed.");
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isCallback]);

  if (autoLaunch) {
    return <main className="oauth-test-shell"><section className="oauth-test-card" aria-live="polite"><BrandMark size={68} /><p className="oauth-test-eyebrow">GSW Account</p><h1>{error ? "Could not start sign-in" : "Opening GSW…"}</h1><p className="oauth-test-copy">{error || "Taking you to GSW authorization."}</p>{error && <button className="oauth-test-primary" onClick={() => void begin()}>Try again</button>}</section></main>;
  }

  return <main className="oauth-test-shell">
    <section className="oauth-test-card" aria-live="polite">
      <BrandMark size={68} />
      {!isCallback ? <>
        <p className="oauth-test-eyebrow">GSW Identity</p>
        <h1>Continue with your GSW Account</h1>
        <p className="oauth-test-copy">Use this page to start the same consent flow available to apps that support GSW sign-in. Apps may request account selection when they need it.</p>
        <button className="oauth-test-google-button" disabled={busy} onClick={() => void begin()}>
          <BrandMark size={22} />
          {busy ? "Opening GSW…" : "Continue with GSW"}
        </button>
        <div className="oauth-test-note">
          <strong>Identity access only</strong>
          <span>Name, profile image, and email address.</span>
          <span>This does not grant mailbox, messages, calendar, contacts, or product API access.</span>
        </div>
      </> : identity ? <>
        <div className="oauth-test-success">✓</div>
        <p className="oauth-test-eyebrow">Connected</p>
        <h1>You’re signed in with GSW</h1>
        <p className="oauth-test-copy">Your GSW identity was connected successfully.</p>
        <div className="oauth-test-account">
          {identity.picture ? <img src={identity.picture} alt="" referrerPolicy="no-referrer" /> : <span>{(identity.name || identity.email || "G").slice(0, 1).toUpperCase()}</span>}
          <div><strong>{identity.name || "GSW user"}</strong><small>{identity.email || "GSW Account"}</small></div>
        </div>
        <button className="oauth-test-primary" onClick={() => window.location.assign("/mail")}>Continue to GSW Mail</button>
      </> : <>
        <p className="oauth-test-eyebrow">GSW Account</p>
        <h1>{busy ? "Finishing your sign-in…" : "Sign-in could not be completed"}</h1>
        <p className="oauth-test-copy">{busy ? "One moment while we finish connecting your GSW Account." : (error || "Please start the sign-in again.")}</p>
        {!busy && <button className="oauth-test-primary" onClick={() => window.location.assign("/oauth/connect")}>Try again</button>}
      </>}
      {error && isCallback && <div className="oauth-test-error">{error}</div>}
      <footer>GSW Mail · OAuth/OpenID Connect</footer>
    </section>
  </main>;
}
