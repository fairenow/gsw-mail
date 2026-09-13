import "../../styles/account-resolution.css";

export type ResolutionState = "idle" | "resolving" | "connecting" | "resolved";

const labels: Record<ResolutionState, string> = {
  idle: "Opening GSW Mail",
  resolving: "Checking your account",
  connecting: "Connecting your mailbox",
  resolved: "You're ready",
};

export function AccountResolutionLoader({ state }: { state: ResolutionState }) {
  return <div className={`gsw-resolution gsw-resolution-${state}`} role="status" aria-live="polite">
    <div className="gsw-resolution-art" aria-hidden="true">
      <span className="gsw-resolution-card">✓</span>
      <img src="/logo-2.png" alt="" />
      <svg className="gsw-resolution-sparks" viewBox="0 0 160 140"><path d="M24 42l-8-6M20 65H8M133 42l8-6M140 65h12" /></svg>
      <span className="gsw-resolution-check">✓</span>
    </div>
    <h1 className="gsw-login-title">{labels[state]}</h1>
    <p className="gsw-login-sub">{state === "resolved" ? "Your account is connected." : "We're securely linking your account."}</p>
  </div>;
}
