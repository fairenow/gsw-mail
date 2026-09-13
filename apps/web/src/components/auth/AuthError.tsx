import type { ReactNode } from "react";

export function AuthError({ children }: { children: ReactNode }) {
  return (
    <p className="gsw-login-error" role="alert">
      {children}
    </p>
  );
}