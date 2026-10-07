import { useMemo, useRef, useState } from "react";
import { ArrowUp, Copy, RefreshCcw } from "lucide-react";
import { api, type AiChatMessage } from "../../api";

const starterPrompts = [
  "Rewrite this email to sound more natural",
  "Make this email shorter and clearer",
  "Help me write a professional follow-up",
];

type ChatSegment =
  | { type: "text"; content: string }
  | { type: "email_draft"; content: string };

const parseAssistantSegments = (content: string): ChatSegment[] => {
  const segments: ChatSegment[] = [];
  const pattern = /<email_draft>([\s\S]*?)<\/email_draft>/gi;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(content)) !== null) {
    const before = content.slice(cursor, match.index).trim();
    if (before) segments.push({ type: "text", content: before });
    const draft = match[1]?.trim();
    if (draft) segments.push({ type: "email_draft", content: draft });
    cursor = pattern.lastIndex;
  }

  const after = content.slice(cursor).trim();
  if (after) segments.push({ type: "text", content: after });
  return segments.length > 0 ? segments : [{ type: "text", content }];
};

const cleanAssistantText = (content: string) => content
  .replace(/<email_draft>/gi, "")
  .replace(/<\/email_draft>/gi, "")
  .trim();

export function ChatPanel() {
  const [messages, setMessages] = useState<AiChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const canSend = input.trim().length > 0 && !sending;

  const visibleMessages = useMemo(() => messages, [messages]);

  const send = async (override?: string) => {
    const content = (override ?? input).trim();
    if (!content || sending) return;
    const userMessage: AiChatMessage = { role: "user", content };
    const next = [...messages, userMessage].slice(-23);
    setMessages(next);
    setInput("");
    setError("");
    setSending(true);
    window.requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }));
    try {
      const response = await api.chat(next);
      setMessages((current) => [...current, response.message].slice(-24));
      window.requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  };

  return <div className="gsw-chat-panel">
    <header className="gsw-chat-header">
      <div className="gsw-chat-heading">
        <span className="gsw-chat-mark" aria-hidden="true"><img className="gsw-chat-brand-logo" src="/logo.png" alt="" /></span>
        <div>
          <h2>GSW Chat</h2>
          <p>Writing help and general conversation</p>
        </div>
      </div>
      {messages.length > 0 && <button className="gsw-chat-clear" type="button" onClick={() => { setMessages([]); setInput(""); setError(""); }}><RefreshCcw size={15} /> New chat</button>}
    </header>

    <div className="gsw-chat-thread">
      {visibleMessages.length === 0 ? <div className="gsw-chat-empty">
        <span className="gsw-chat-empty-icon"><img className="gsw-chat-brand-logo" src="/logo.png" alt="" /></span>
        <h3>What can I help you write?</h3>
        <p>Paste an email, describe what you want to say, or just start a conversation.</p>
        <div className="gsw-chat-starters">{starterPrompts.map((prompt) => <button type="button" key={prompt} onClick={() => setInput(prompt)}>{prompt}</button>)}</div>
      </div> : visibleMessages.map((message, index) => {
        const segments = message.role === "assistant" ? parseAssistantSegments(message.content) : null;
        return <article className={`gsw-chat-message ${message.role}`} key={`${message.role}-${index}`}>
          <div className="gsw-chat-message-label">{message.role === "user" ? "You" : "GSW"}</div>
          {message.role === "assistant" ? <div className="gsw-chat-assistant-content">
            {segments?.map((segment, segmentIndex) => segment.type === "email_draft"
              ? <section className="gsw-chat-email-draft" key={`draft-${segmentIndex}`}>
                  <div className="gsw-chat-email-draft-head">
                    <span>Email draft</span>
                    <button className="gsw-chat-copy gsw-chat-email-copy" type="button" aria-label="Copy email draft" title="Copy email draft" onClick={() => void navigator.clipboard.writeText(segment.content)}><Copy size={14} strokeWidth={1.8} /></button>
                  </div>
                  <div className="gsw-chat-email-draft-body">{segment.content}</div>
                </section>
              : <div className="gsw-chat-message-body" key={`text-${segmentIndex}`}>{segment.content}</div>)}
          </div> : <div className="gsw-chat-message-body">{message.content}</div>}
          <button className="gsw-chat-copy" type="button" aria-label={message.role === "user" ? "Copy prompt" : "Copy full response"} title={message.role === "user" ? "Copy prompt" : "Copy full response"} onClick={() => void navigator.clipboard.writeText(message.role === "assistant" ? cleanAssistantText(message.content) : message.content)}><Copy size={14} strokeWidth={1.8} /></button>
        </article>;
      })}
      {sending && <article className="gsw-chat-message assistant gsw-chat-thinking"><div className="gsw-chat-message-label">GSW</div><div className="gsw-chat-thinking-dots" aria-label="Thinking"><span /><span /><span /></div></article>}
      {error && <div className="gsw-chat-error">{error}</div>}
      <div ref={bottomRef} />
    </div>

    <footer className="gsw-chat-composer">
      <div className="gsw-chat-composer-box">
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              if (canSend) void send();
            }
          }}
          placeholder="Ask for help writing or rewriting an email…"
          rows={1}
        />
        <button className="gsw-chat-send" type="button" aria-label="Send message" disabled={!canSend} onClick={() => void send()}><ArrowUp size={18} strokeWidth={2} /></button>
      </div>
      <p>Chat can draft and rewrite. It cannot read your mailbox or take actions yet.</p>
    </footer>
  </div>;
}
