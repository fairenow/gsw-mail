import { useEffect, useState, type FormEvent } from "react";
import { api, type Contact } from "../../api";
import { RichTextEditor } from "../RichTextEditor";

export type ComposeMode = "new" | "reply" | "replyAll" | "forward";

function RecipientField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const [focused, setFocused] = useState(false);
  const [results, setResults] = useState<Contact[]>([]);
  const query = value.split(",").at(-1)?.trim() ?? "";
  useEffect(() => {
    if (!focused) return;
    const timer = window.setTimeout(() => { void api.contacts(query).then(setResults).catch(() => setResults([])); }, 180);
    return () => window.clearTimeout(timer);
  }, [focused, query]);
  const select = (contact: Contact) => {
    const address = contact.emails[0]?.email;
    if (!address) return;
    const prefix = value.slice(0, value.lastIndexOf(",") + 1);
    onChange(`${prefix}${prefix ? " " : ""}${address}, `);
    setFocused(false);
  };
  return <div className="gsw-recipient-field">
    <input value={value} onChange={(event) => onChange(event.target.value)} onFocus={() => setFocused(true)} onBlur={() => window.setTimeout(() => setFocused(false), 150)} placeholder={label} aria-label={label} required={label === "To"} />
    {focused && results.length > 0 && <div className="gsw-contact-autocomplete">{results.slice(0, 7).map((contact) => <button type="button" key={contact.id} onMouseDown={(event) => event.preventDefault()} onClick={() => select(contact)}><strong>{contact.displayName || contact.emails[0]?.email}</strong><span>{contact.jobTitle || contact.organization || contact.emails[0]?.email}</span><small>{contact.emails[0]?.email}</small></button>)}</div>}
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
    <div className="gsw-compose-head"><strong>{title}</strong><div><button className="gsw-compose-head-action" onClick={onMinimize} aria-label="Minimize compose">−</button><button className="gsw-compose-head-action" onClick={onClose} aria-label="Close compose">×</button></div></div>
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
