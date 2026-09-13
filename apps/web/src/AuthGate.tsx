import { useEffect, useState, type ReactNode } from "react";
import { accessToken, finishSignIn, logout, signIn } from "./auth";

const isCallback = window.location.pathname === "/auth/callback";

export function AuthGate({ children }: { children: ReactNode }) {
  const [authenticated, setAuthenticated] = useState(!!accessToken());
  const [pending, setPending] = useState(isCallback);
  const [error, setError] = useState("");
  useEffect(() => {
    const update = () => setAuthenticated(!!accessToken());
    window.addEventListener("gsw-auth-change", update);
    const timer = window.setInterval(update, 1000);
    if (isCallback) void finishSignIn().catch((err: unknown) => setError(err instanceof Error ? err.message : "Sign-in failed")).finally(() => { setPending(false); update(); });
    return () => { window.removeEventListener("gsw-auth-change", update); window.clearInterval(timer); };
  }, []);
  if (pending) return <main><p>Completing sign-in…</p></main>;
  if (!authenticated) return <main style={{ maxWidth: 440, margin: "15vh auto", padding: 24 }}><h1>Guided Steps Mail</h1><p>Sign in with your mail account.</p>{error && <p role="alert">{error}</p>}<button onClick={() => { setPending(true); void signIn().catch(() => { setError("Unable to start sign-in. Please try again."); setPending(false); }); }}>Sign In</button></main>;
  return <><div style={{ textAlign: "right", padding: 8 }}><button onClick={logout}>Sign Out</button></div>{children}</>;
}
