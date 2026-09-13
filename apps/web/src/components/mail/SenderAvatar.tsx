export function SenderAvatar({ name, email, size = "normal" }: { name?: string; email?: string; size?: "normal" | "large" }) {
  const label = (name || email || "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

  return <span className={`gsw-avatar ${size === "large" ? "gsw-avatar-large" : ""}`} aria-hidden="true">{label}</span>;
}
