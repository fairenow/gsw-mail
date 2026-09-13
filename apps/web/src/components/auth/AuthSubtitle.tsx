import type { ReactNode } from "react";

export function AuthSubtitle({ children }: { children: ReactNode }) {
  return <p className="gsw-login-sub">{children}</p>;
}