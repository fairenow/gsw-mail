import { useMemo, useRef, useState } from "react";
import { ArrowUp, Copy, RefreshCcw, Sparkles } from "lucide-react";
import { api, type AiChatMessage } from "../../api";

const starterPrompts = [
  "Rewrite this email to sound more natural",
  "Make this email shorter and clearer",
  "Help me write a professional follow-up",
];

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
        <span className="gsw-chat-mark" aria-hidden="true"><Sparkles size={19} strokeWidth={1.7} /></span>
        <div>
          <h2>GSW Chat</h2>
          <p>Writing help and general conversation</p>
        </div>
      </div>
      {messages.length > 0 && <button className="gsw-chat-clear" type="button" onClick={() => { setMessages([]); setInput(""); setError(""); }}><RefreshCcw size={15} /> New chat</button>}
    </header>

    <div className="gsw-chat-thread">
      {visibleMessages.length === 0 ? <div className="gsw-chat-empty">
        <span className="gsw-chat-empty-icon"><Sparkles size={26} strokeWidth={1.5} /></span>
        <h3>What can I help you write?</h3>
        <p>Paste an email, describe what you want to say, or just start a conversation.</p>
        <div className="gsw-chat-starters">{starterPrompts.map((prompt) => <button type="button" key={prompt} onClick={() => setInput(prompt)}>{prompt}</button>)}</div>
      </div> : visibleMessages.map((message, index) => <article className={`gsw-chat-message ${message.role}`} key={`${message.role}-${index}`}>
        <div className="gsw-chat-message-label">{message.role === "user" ? "You" : "GSW"}</div>
        <div className="gsw-chat-message-body">{message.content}</div>
        <button className="gsw-chat-copy" type="button" aria-label={message.role === "user" ? "Copy prompt" : "Copy response"} title={message.role === "user" ? "Copy prompt" : "Copy response"} onClick={() => void navigator.clipboard.writeText(message.content)}><Copy size={14} strokeWidth={1.8} /></button>
      </article>)}
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
