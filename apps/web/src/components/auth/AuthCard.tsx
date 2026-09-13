import type { ReactNode } from "react";

export function AuthCard({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={className ?? "gsw-login-card"}>{children}</div>;
}