import type { ReactNode } from "react";

export function AuthPage({ children }: { children: ReactNode }) {
  return (
    <main className="gsw-login">
      <div className="gsw-login-stage">
        {children}
        <footer className="gsw-login-footer">Guided Steps Wellness · Community Mail</footer>
      </div>
    </main>
  );
}