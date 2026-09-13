import { useState } from "react";

export function SenderAvatar({ name, email, imageUrl, size = "normal" }: { name?: string; email?: string; imageUrl?: string; size?: "normal" | "large" }) {
  const [imageFailed, setImageFailed] = useState(false);
  const label = (name || email || "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

  return <span className={`gsw-avatar ${size === "large" ? "gsw-avatar-large" : ""}`} aria-hidden="true">{imageUrl && !imageFailed ? <img src={imageUrl} alt="" onError={() => setImageFailed(true)} /> : label}</span>;
}
