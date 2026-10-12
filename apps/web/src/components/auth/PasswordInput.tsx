import { useState, type InputHTMLAttributes } from "react";

export function PasswordInput(props: Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  const [visible, setVisible] = useState(false);
  return <span style={{ display: "flex", position: "relative", alignItems: "center", width: "100%" }}>
    <input {...props} type={visible ? "text" : "password"} style={{ ...props.style, width: "100%", paddingRight: "3rem" }} />
    <button type="button" aria-label={visible ? "Hide password" : "Show password"} aria-pressed={visible}
      onClick={() => setVisible(v => !v)}
      style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", display: "grid", placeItems: "center", border: 0, background: "transparent", color: "inherit", cursor: "pointer", width: 36, height: 36 }}>
      {visible ? <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8"/><path d="M9.9 5.2A10.5 10.5 0 0 1 12 5c5.2 0 9 5 9 7a11 11 0 0 1-3 3.8M6.7 6.7C4.5 8.1 3 10.5 3 12c0 2 3.8 7 9 7a10 10 0 0 0 3.3-.5"/></svg>
      : <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2 12s3.8-7 10-7 10 7 10 7-3.8 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>}
    </button>
  </span>;
}
