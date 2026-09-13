import type { FormEvent } from "react";

export type ComposeMode = "new" | "reply" | "replyAll" | "forward";

export function ComposeWindow({ mode, to, cc, subject, text, sending, sendNote, onToChange, onCcChange, onSubjectChange, onTextChange, onClose, onSubmit, onUndo }: {
  mode: ComposeMode;
  to: string;
  cc: string;
  subject: string;
  text: string;
  sending: boolean;
  sendNote?: string;
  onToChange: (value: string) => void;
  onCcChange: (value: string) => void;
  onSubjectChange: (value: string) => void;
  onTextChange: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
  onUndo?: () => void;
}) {
  const submit = (event: FormEvent) => { event.preventDefault(); onSubmit(); };
  const title = mode === "new" ? "New message" : mode === "forward" ? "Forward message" : mode === "replyAll" ? "Reply all" : "Reply";
  return <section className="gsw-compose-window" aria-label="Compose message">
    <div className="gsw-compose-head"><strong>{title}</strong><button className="gsw-compose-close" onClick={onClose} aria-label="Close compose">×</button></div>
    <form className="gsw-compose-form" onSubmit={submit}>
      <input value={to} onChange={(event) => onToChange(event.target.value)} placeholder="To" aria-label="To" required />
      <input value={cc} onChange={(event) => onCcChange(event.target.value)} placeholder="Cc" aria-label="Cc" />
      <input value={subject} onChange={(event) => onSubjectChange(event.target.value)} placeholder="Subject" aria-label="Subject" />
      <textarea value={text} onChange={(event) => onTextChange(event.target.value)} placeholder="Write a message" aria-label="Message body" />
      <div className="gsw-compose-actions"><span className="gsw-send-note">{sendNote}{sendNote && onUndo && <button type="button" className="gsw-link-btn" onClick={onUndo}>Undo</button>}</span><button className="gsw-primary-btn" type="submit" disabled={sending}>{sending ? "Sending..." : "Send"}</button></div>
    </form>
  </section>;
}
