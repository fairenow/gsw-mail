import type { ReactNode } from "react";

export function AuthHeading({ children }: { children: ReactNode }) {
  return <h1 className="gsw-login-title">{children}</h1>;
}