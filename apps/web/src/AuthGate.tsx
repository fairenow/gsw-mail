import { useEffect, useState, type ReactNode } from "react";
import { accessToken, finishSignIn, logout, signIn } from "./auth";

const isCallback = window.location.pathname === "/auth/callback";

function Brand({ size, className }: { size: number; className?: string }) {
  return (
    <img
      src="/logo.png"
      alt="Guided Steps Mail"
      className={className}
      style={{ width: size, height: size, display: "block" }}
    />
  );
}

export function AuthGate({ children }: { children: ReactNode }) {
  const [authenticated, setAuthenticated] = useState(!!accessToken());
  const [pending, setPending] = useState(isCallback);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const update = () => setAuthenticated(!!accessToken());
    window.addEventListener("gsw-auth-change", update);
    const timer = window.setInterval(update, 1000);
    if (isCallback) {
      void finishSignIn()
        .catch((err: unknown) => setError(err instanceof Error ? err.message : "Could not complete sign-in."))
        .finally(() => {
          setPending(false);
          update();
        });
    }
    return () => {
      window.removeEventListener("gsw-auth-change", update);
      window.clearInterval(timer);
    };
  }, []);

  if (pending) {
    return (
      <main className="gsw-login">
        <div className="gsw-login-card a-scale">
          <Brand size={88} className="gsw-login-intro" />
          <p className="gsw-login-hint">Completing sign-in…</p>
        </div>
      </main>
    );
  }

  if (!authenticated) {
    return (
      <main className="gsw-login">
        <div className="gsw-login-card a-rise">
          <div className="gsw-login-mark-wrap">
            <Brand size={128} className="gsw-intro-logo" />
          </div>
          <h1 className="gsw-login-title">Mail for your community</h1>
          <p className="gsw-login-sub">
            Stay connected with your wellness community — one warm inbox for every guided step.
          </p>
          <button
            type="button"
            className="gsw-btn gsw-btn-primary gsw-btn-block gsw-btn-lg"
            disabled={starting}
            onClick={() => {
              setStarting(true);
              setError("");
              signIn().catch((err: unknown) => {
                setError(err instanceof Error ? err.message : "Unable to start sign-in.");
                setStarting(false);
              });
            }}
          >
            <span>Sign in with Guided Steps</span>
            <span className="gsw-btn-arrow" aria-hidden="true">
              →
            </span>
          </button>
          <button
            type="button"
            className="gsw-btn gsw-btn-ghost"
            onClick={() => {
              setStarting(false);
              setError("");
              void signIn().catch((err: unknown) => setError(err instanceof Error ? err.message : "Unable to start sign-in."));
            }}
          >
            Or use another account
          </button>
          {error && (
            <p className="gsw-login-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <footer className="gsw-login-footer">Guided Steps Wellness · Community Mail</footer>
      </main>
    );
  }

  return (
    <div className="gsw-auth-shell">
      <div className="gsw-topbar">
        <Brand size={32} className="gsw-topbrand" />
        <button
          type="button"
          className="gsw-btn gsw-btn-quiet"
          onClick={() => {
            logout();
          }}
        >
          Sign out
        </button>
      </div>
      {children}
    </div>
  );
}
