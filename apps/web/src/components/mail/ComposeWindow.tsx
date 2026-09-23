import { useEffect, useRef, useState, type FormEvent } from "react";
import { Minus, X } from "lucide-react";
import { RichTextEditor } from "../RichTextEditor";

export type ComposeMode = "new" | "reply" | "replyAll" | "forward";

type ContactSuggestion = { id: string; displayName: string | null; organization: string | null; jobTitle: string | null; email: string };
type LegacyContact = { id: string; displayName?: string | null; organization?: string | null; jobTitle?: string | null; emails?: { email: string; isPrimary?: boolean }[] };
const contactCache = new Map<string, { expiresAt: number; contacts: ContactSuggestion[] }>();
const CONTACT_CACHE_TTL_MS = 30_000;

const normalizeSuggestion = (contact: LegacyContact): ContactSuggestion | null => {
  const email = contact.emails?.find((item) => item.isPrimary)?.email ?? contact.emails?.[0]?.email ?? "";
  if (!email) return null;
  return { id: contact.id, displayName: contact.displayName ?? null, organization: contact.organization ?? null, jobTitle: contact.jobTitle ?? null, email };
};

async function contactSuggestions(query: string): Promise<ContactSuggestion[]> {
  const preferred = await fetch(`/product/contact-suggestions?q=${encodeURIComponent(query)}`, { credentials: "include" });
  if (preferred.ok) {
    const body = await preferred.json() as { contacts?: ContactSuggestion[] };
    return body.contacts ?? [];
  }

  // Keep autocomplete working during staggered Vercel/Railway deploys or if the
  // optimized suggestions endpoint is temporarily unavailable.
  const fallback = await fetch(`/product/contacts?q=${encodeURIComponent(query)}&limit=20&offset=0`, { credentials: "include" });
  if (!fallback.ok) throw new Error(`contact suggestions failed: ${preferred.status}/${fallback.status}`);
  const body = await fallback.json() as { contacts?: LegacyContact[] };
  const seen = new Set<string>();
  return (body.contacts ?? []).map(normalizeSuggestion).filter((item): item is ContactSuggestion => {
    if (!item) return false;
    const email = item.email.trim().toLowerCase();
    if (!email || seen.has(email)) return false;
    seen.add(email);
    return true;
  }).slice(0, 20);
}

function RecipientField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const [focused, setFocused] = useState(false);
  const [results, setResults] = useState<ContactSuggestion[]>([]);
  const requestId = useRef(0);
  const query = value.split(",").at(-1)?.trim() ?? "";

  useEffect(() => {
    if (!focused || query.length < 2) {
      setResults([]);
      return;
    }
    const normalizedQuery = query.toLowerCase();
    const cached = contactCache.get(normalizedQuery);
    if (cached && cached.expiresAt > Date.now()) {
      setResults(cached.contacts);
      return;
    }
    const currentRequest = ++requestId.current;
    const timer = window.setTimeout(() => {
      void contactSuggestions(query).then((contacts) => {
        if (currentRequest !== requestId.current) return;
        contactCache.set(normalizedQuery, { expiresAt: Date.now() + CONTACT_CACHE_TTL_MS, contacts });
        if (contactCache.size > 100) contactCache.delete(contactCache.keys().next().value!);
        setResults(contacts);
      }).catch(() => {
        if (currentRequest === requestId.current) setResults([]);
      });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [focused, query]);

  const select = (contact: ContactSuggestion) => {
    const prefix = value.slice(0, value.lastIndexOf(",") + 1);
    onChange(`${prefix}${prefix ? " " : ""}${contact.email}, `);
    setFocused(false);
  };

  return <div className="gsw-recipient-field">
    <input value={value} onChange={(event) => onChange(event.target.value)} onFocus={() => setFocused(true)} onBlur={() => window.setTimeout(() => setFocused(false), 150)} placeholder={label} aria-label={label} required={label === "To"} autoComplete="off" />
    {focused && results.length > 0 && <div className="gsw-contact-autocomplete">{results.map((contact) => {
      const email = contact.email.trim();
      const name = contact.displayName?.trim();
      const detail = contact.jobTitle?.trim() || contact.organization?.trim();
      const heading = name && name.toLowerCase() !== email.toLowerCase() ? name : email;
      return <button type="button" key={`${contact.id}:${email}`} onMouseDown={(event) => event.preventDefault()} onClick={() => select(contact)}>
        <strong>{heading}</strong>
        {detail && detail.toLowerCase() !== heading.toLowerCase() && detail.toLowerCase() !== email.toLowerCase() && <span>{detail}</span>}
        {heading.toLowerCase() !== email.toLowerCase() && <small>{email}</small>}
      </button>;
    })}</div>}
  </div>;
}

export function ComposeWindow({ mode, minimized, to, cc, bcc, subject, html, sending, draftStatus, sendError, sendNote, onToChange, onCcChange, onBccChange, onSubjectChange, onHtmlChange, onMinimize, onClose, onSubmit, onRetry, onUndo }: {
  mode: ComposeMode;
  minimized: boolean;
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  html: string;
  sending: boolean;
  draftStatus: "idle" | "saving" | "saved" | "notSaved";
  sendError?: string | null;
  sendNote?: string;
  onToChange: (value: string) => void;
  onCcChange: (value: string) => void;
  onBccChange: (value: string) => void;
  onSubjectChange: (value: string) => void;
  onHtmlChange: (value: string) => void;
  onMinimize: () => void;
  onClose: () => void;
  onSubmit: () => void;
  onRetry: () => void;
  onUndo?: () => void;
}) {
  const [showBcc, setShowBcc] = useState(Boolean(bcc));
  const submit = (event: FormEvent) => { event.preventDefault(); onSubmit(); };
  const title = mode === "new" ? "New message" : mode === "forward" ? "Forward message" : mode === "replyAll" ? "Reply all" : "Reply";
  const status = draftStatus === "saving" ? "Saving..." : draftStatus === "saved" ? "Saved" : draftStatus === "notSaved" ? "Not saved" : "";
  if (minimized) return <button className="gsw-compose-minimized" onClick={onMinimize}><span><strong>{title}</strong><small>{subject || to || "New draft"}</small></span><span className="gsw-compose-minimized-status">{status || "Draft"}</span></button>;
  return <section className="gsw-compose-window" aria-label="Compose message">
    <div className="gsw-compose-head"><strong>{title}</strong><div><button className="gsw-compose-head-action" onClick={onMinimize} aria-label="Minimize compose"><Minus size={16} strokeWidth={1.75} aria-hidden="true" /></button><button className="gsw-compose-head-action" onClick={onClose} aria-label="Close compose"><X size={16} strokeWidth={1.75} aria-hidden="true" /></button></div></div>
    <form className="gsw-compose-form" onSubmit={submit}>
      <div className="gsw-recipient-row"><RecipientField label="To" value={to} onChange={onToChange} /><button type="button" className="gsw-recipient-toggle" onClick={() => setShowBcc((current) => !current)}>Cc/Bcc</button></div>
      <RecipientField label="Cc" value={cc} onChange={onCcChange} />
      {showBcc && <RecipientField label="Bcc" value={bcc} onChange={onBccChange} />}
      <input value={subject} onChange={(event) => onSubjectChange(event.target.value)} placeholder="Subject" aria-label="Subject" />
      <RichTextEditor value={html} onChange={onHtmlChange} placeholder="Write a message" />
      <div className="gsw-compose-actions"><span className={`gsw-send-note ${sendError ? "gsw-send-error" : ""}`}>{sendError || status || sendNote}{sendError && <button type="button" className="gsw-link-btn" onClick={onRetry}>Retry</button>}{sendNote && onUndo && <button type="button" className="gsw-link-btn" onClick={onUndo}>Undo</button>}</span><button className="gsw-primary-btn" type="submit" disabled={sending}>{sending ? "Sending..." : "Send"}</button></div>
    </form>
  </section>;
}
