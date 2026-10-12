import { useEffect, useState } from "react";
import { api } from "../../api";

const cached = new Map<string, string | null>();
const waiting = new Map<string, Array<(value: string | null) => void>>();
let scheduled = false;

function lookup(email: string): Promise<string | null> {
  const key = email.trim().toLowerCase();
  if (!key) return Promise.resolve(null);
  if (cached.has(key)) return Promise.resolve(cached.get(key) ?? null);
  return new Promise(resolve => {
    waiting.set(key, [...(waiting.get(key) ?? []), resolve]);
    if (scheduled) return;
    scheduled = true;
    setTimeout(async () => {
      scheduled = false;
      const batch = [...waiting.keys()].slice(0, 30);
      try {
        const result = await api.lookupAvatars(batch);
        for (const address of batch) {
          const value = result.avatars[address] ?? null;
          cached.set(address, value);
          waiting.get(address)?.forEach(done => done(value));
          waiting.delete(address);
        }
      } catch {
        for (const address of batch) {
          waiting.get(address)?.forEach(done => done(null));
          waiting.delete(address);
        }
      }
      if (waiting.size) void lookup([...waiting.keys()][0]!);
    }, 70);
  });
}

export function SenderAvatar({ name, email, imageUrl, size = "normal" }: { name?: string; email?: string; imageUrl?: string; size?: "normal" | "large" }) {
  const [discovered, setDiscovered] = useState<string | null>(null);
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => {
    if (imageUrl || !email) { setDiscovered(null); return; }
    let mounted = true;
    void lookup(email).then(value => { if (mounted) setDiscovered(value); });
    return () => { mounted = false; };
  }, [email, imageUrl]);
  const effective = imageUrl || discovered;
  const label = (name || email || "?").split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join("").toUpperCase();
  return <span className={`gsw-avatar ${size === "large" ? "gsw-avatar-large" : ""}`} aria-hidden="true">
    {effective && !imageFailed ? <img src={effective} alt="" onError={() => setImageFailed(true)} /> : label}
  </span>;
}
