import { useEffect, useState, type ReactNode } from "react";
import { accessToken, finishSignIn, signIn } from "./auth";
import { AuthCard } from "./components/auth/AuthCard";
import { AuthError } from "./components/auth/AuthError";
import { AuthHeading } from "./components/auth/AuthHeading";
import { AuthPage } from "./components/auth/AuthPage";
import { AuthSubtitle } from "./components/auth/AuthSubtitle";
import { BrandMark } from "./components/auth/BrandMark";
import { PrimarySignInButton } from "./components/auth/PrimarySignInButton";
import { SecondaryAccountButton } from "./components/auth/SecondaryAccountButton";

const isCallback = window.location.pathname === "/auth/callback";

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
      <AuthPage>
        <AuthCard>
          <BrandMark size={80} className="gsw-login-intro" />
          <p className="gsw-login-hint">Completing sign-in…</p>
        </AuthCard>
      </AuthPage>
    );
  }

  if (!authenticated) {
    return (
      <AuthPage>
        <AuthCard>
          <BrandMark size={80} className="gsw-intro-logo" />
          <AuthHeading>Mail for your community</AuthHeading>
          <AuthSubtitle>
            Stay connected with your wellness community — one warm inbox for every guided step.
          </AuthSubtitle>
          <PrimarySignInButton
            disabled={starting}
            onStart={() => {
              setStarting(true);
              setError("");
              signIn().catch((err: unknown) => {
                setError(err instanceof Error ? err.message : "Unable to start sign-in.");
                setStarting(false);
              });
            }}
          />
          <SecondaryAccountButton
            onUse={() => {
              setStarting(false);
              setError("");
              void signIn({ forceLogin: true }).catch((err: unknown) => setError(err instanceof Error ? err.message : "Unable to start sign-in."));
            }}
          />
          {error && <AuthError>{error}</AuthError>}
        </AuthCard>
      </AuthPage>
    );
  }

  return children;
}
