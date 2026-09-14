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
      <picture>
        <source media="(prefers-reduced-motion: reduce)" srcSet="/logo-2.png" />
        <img src={state === "resolved" ? "/logo-2.png" : "/loading-animation-1.gif"} alt="" />
      </picture>
      <span className="gsw-resolution-check">✓</span>
    </div>
    <h1 className="gsw-login-title">{labels[state]}</h1>
    <p className="gsw-login-sub">{state === "resolved" ? "Your account is connected." : "We're securely linking your account."}</p>
  </div>;
}
