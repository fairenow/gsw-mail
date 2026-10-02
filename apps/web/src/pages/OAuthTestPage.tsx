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
  token_type: string;
  expires_in?: number;
  scope?: string;
  id_token?: string;
};

type TestTransaction = {
  state: string;
  nonce: string;
  verifier: string;
  redirectUri: string;
};

type VerifiedIdentity = {
  sub: string;
  name?: string;
  email?: string;
  email_verified?: boolean;
  picture?: string;
  issuer: string;
  audience: string | string[];
  signatureVerified: boolean;
  userInfoMatched: boolean;
  productApiIsolated: boolean;
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
  if (!response.ok) throw new Error("Could not load the GSW identity configuration.");
  const discovery = await response.json() as Discovery;
  for (const endpoint of [discovery.authorization_endpoint, discovery.token_endpoint, discovery.userinfo_endpoint, discovery.jwks_uri]) {
    const url = new URL(endpoint);
    if (url.origin !== window.location.origin) throw new Error("GSW identity configuration returned an unexpected host.");
  }
  return discovery;
}

function saveTransaction(transaction: TestTransaction): void {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(transaction));
}

function readTransaction(): TestTransaction {
  const raw = sessionStorage.getItem(STORAGE_KEY);
  if (!raw) throw new Error("This sign-in attempt has expired. Start again.");
  const transaction = JSON.parse(raw) as Partial<TestTransaction>;
  if (!transaction.state || !transaction.nonce || !transaction.verifier || !transaction.redirectUri) throw new Error("The saved sign-in attempt is incomplete. Start again.");
  return transaction as TestTransaction;
}

async function verifyIdToken(idToken: string, discovery: Discovery, expectedNonce: string): Promise<Record<string, unknown>> {
  const parts = idToken.split(".");
  if (parts.length !== 3) throw new Error("The ID token format was invalid.");
  const header = JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[0]))) as { alg?: string; kid?: string };
  const payload = JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[1]))) as Record<string, unknown>;
  if (header.alg !== "ES256" || !header.kid) throw new Error("The ID token used an unexpected signing algorithm.");

  const jwksResponse = await fetch(discovery.jwks_uri, { credentials: "omit" });
  if (!jwksResponse.ok) throw new Error("Could not load GSW signing keys.");
  const jwks = await jwksResponse.json() as { keys?: SigningJwk[] };
  const key = jwks.keys?.find((candidate) => candidate.kid === header.kid);
  if (!key) throw new Error("The ID token signing key was not found.");
  const cryptoKey = await crypto.subtle.importKey("jwk", key, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  const signature = Uint8Array.from(decodeBase64Url(parts[2]));
  const signatureVerified = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    cryptoKey,
    signature,
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  if (!signatureVerified) throw new Error("The ID token signature could not be verified.");

  if (payload.iss !== discovery.issuer) throw new Error("The ID token issuer did not match GSW.");
  const audience = payload.aud;
  const audienceMatches = audience === CLIENT_ID || (Array.isArray(audience) && audience.includes(CLIENT_ID));
  if (!audienceMatches) throw new Error("The ID token audience did not match this application.");
  if (payload.nonce !== expectedNonce) throw new Error("The ID token nonce did not match this sign-in attempt.");
  if (typeof payload.exp !== "number" || payload.exp <= Math.floor(Date.now() / 1000)) throw new Error("The ID token is expired.");
  if (typeof payload.sub !== "string" || !payload.sub) throw new Error("The ID token did not contain a subject.");
  return payload;
}

export function OAuthTestPage() {
  const isCallback = window.location.pathname === "/oauth/test/callback";
  const [busy, setBusy] = useState(false);
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
    if (!isCallback) return;
    let cancelled = false;
    void (async () => {
      setBusy(true);
      try {
        const params = new URLSearchParams(window.location.search);
        const providerError = params.get("error");
        if (providerError) {
          const description = params.get("error_description");
          throw new Error(providerError === "access_denied" ? "You cancelled the GSW authorization request." : (description || `GSW returned ${providerError}.`));
        }
        const code = params.get("code");
        const returnedState = params.get("state");
        const transaction = readTransaction();
        if (!code || !returnedState || returnedState !== transaction.state) throw new Error("The OAuth state check failed. Start again.");

        const discovery = await getDiscovery();
        const body = new URLSearchParams({
          grant_type: "authorization_code",
          client_id: CLIENT_ID,
          code,
          redirect_uri: transaction.redirectUri,
          code_verifier: transaction.verifier,
        });
        const tokenResponse = await fetch(discovery.token_endpoint, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          credentials: "omit",
          body,
        });
        const tokens = await tokenResponse.json() as TokenResponse & { error?: string; error_description?: string };
        if (!tokenResponse.ok || !tokens.access_token || !tokens.id_token) throw new Error(tokens.error_description || tokens.error || "GSW did not issue the expected tokens.");

        const claims = await verifyIdToken(tokens.id_token, discovery, transaction.nonce);
        const userInfoResponse = await fetch(discovery.userinfo_endpoint, {
          headers: { authorization: `Bearer ${tokens.access_token}` },
          credentials: "omit",
        });
        if (!userInfoResponse.ok) throw new Error("The GSW UserInfo request failed.");
        const userInfo = await userInfoResponse.json() as Record<string, unknown>;
        const userInfoMatched = typeof userInfo.sub === "string" && userInfo.sub === claims.sub;
        if (!userInfoMatched) throw new Error("The UserInfo subject did not match the ID token subject.");

        const productResponse = await fetch("/api/account/diagnostics", {
          headers: { authorization: `Bearer ${tokens.access_token}` },
          credentials: "omit",
        });
        const productApiIsolated = productResponse.status === 401;
        if (!productApiIsolated) throw new Error(`The identity-only access token reached a GSW product API unexpectedly (${productResponse.status}).`);

        if (!cancelled) {
          setIdentity({
            sub: String(claims.sub),
            name: typeof userInfo.name === "string" ? userInfo.name : undefined,
            email: typeof userInfo.email === "string" ? userInfo.email : undefined,
            email_verified: typeof userInfo.email_verified === "boolean" ? userInfo.email_verified : undefined,
            picture: typeof userInfo.picture === "string" ? userInfo.picture : undefined,
            issuer: String(claims.iss),
            audience: claims.aud as string | string[],
            signatureVerified: true,
            userInfoMatched,
            productApiIsolated,
          });
          sessionStorage.removeItem(STORAGE_KEY);
          window.history.replaceState({}, "", "/oauth/test/callback");
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "GSW OAuth verification failed.");
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isCallback]);

  return <main className="oauth-test-shell">
    <section className="oauth-test-card" aria-live="polite">
      <BrandMark size={68} />
      {!isCallback ? <>
        <p className="oauth-test-eyebrow">GSW Identity Test</p>
        <h1>Sign in with your GSW Account</h1>
        <p className="oauth-test-copy">This page acts like a separate app so we can test the same OAuth flow another GSW-connected product will use.</p>
        <button className="oauth-test-google-button" disabled={busy} onClick={() => void begin()}>
          <span className="oauth-test-mark">G</span>
          {busy ? "Opening GSW…" : "Continue with GSW"}
        </button>
        <div className="oauth-test-note">
          <strong>Requested access</strong>
          <span>Basic identity, profile, and email only.</span>
          <span>No mailbox, messages, calendar, contacts, or product API access.</span>
        </div>
      </> : identity ? <>
        <div className="oauth-test-success">✓</div>
        <p className="oauth-test-eyebrow">OAuth verified</p>
        <h1>GSW sign-in worked</h1>
        <p className="oauth-test-copy">The authorization code, PKCE exchange, ID token signature, UserInfo identity, and product-API isolation all passed.</p>
        <div className="oauth-test-account">
          {identity.picture ? <img src={identity.picture} alt="" referrerPolicy="no-referrer" /> : <span>{(identity.name || identity.email || "G").slice(0, 1).toUpperCase()}</span>}
          <div><strong>{identity.name || "GSW user"}</strong><small>{identity.email || "No email claim returned"}</small></div>
        </div>
        <dl className="oauth-test-results">
          <div><dt>ID token signature</dt><dd>Verified</dd></div>
          <div><dt>UserInfo subject</dt><dd>Matched</dd></div>
          <div><dt>GSW product API</dt><dd>Blocked as expected</dd></div>
          <div><dt>Subject</dt><dd className="oauth-test-mono">{identity.sub}</dd></div>
        </dl>
        <button className="oauth-test-primary" onClick={() => window.location.assign("/oauth/test")}>Test again</button>
      </> : <>
        <p className="oauth-test-eyebrow">GSW Identity Test</p>
        <h1>{busy ? "Verifying your GSW sign-in…" : "Sign-in could not be verified"}</h1>
        <p className="oauth-test-copy">{busy ? "Checking the code exchange, signed ID token, UserInfo response, and product API boundary." : "The test stopped before accepting the identity."}</p>
        {!busy && <button className="oauth-test-primary" onClick={() => window.location.assign("/oauth/test")}>Start again</button>}
      </>}
      {error && <div className="oauth-test-error">{error}</div>}
      <footer>GSW Mail · OAuth/OIDC test client</footer>
    </section>
  </main>;
}
