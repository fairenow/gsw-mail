import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, ArrowUp, Check, CheckCircle2, Copy, LoaderCircle, RefreshCcw, ShieldCheck, X } from "lucide-react";
import { api, type AiChatMessage, type AiChatStreamEvent, type AiIntervention } from "../../api";
import { useAppShell } from "../AppShell";

const starterPrompts = [
  "Rewrite this email to sound more natural",
  "Make this email shorter and clearer",
  "Help me write a professional follow-up",
];

type ChatSegment =
  | { type: "text"; content: string }
  | { type: "email_draft"; content: string };

type ExecutionActivity = {
  id: number;
  label: string;
  toolName?: string;
  status: "running" | "done" | "error";
};

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
  const { account } = useAppShell();
  const [messages, setMessages] = useState<AiChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversationLoading, setConversationLoading] = useState(false);
  const [intervention, setIntervention] = useState<AiIntervention | null>(null);
  const [interventionBusy, setInterventionBusy] = useState(false);
  const [executionActivities, setExecutionActivities] = useState<ExecutionActivity[]>([]);
  const activityCounterRef = useRef(0);
  const activityClearTimerRef = useRef<number | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const canSend = input.trim().length > 0 && !sending;

  const visibleMessages = useMemo(() => messages, [messages]);

  const handleStreamEvent = (event: AiChatStreamEvent) => {
    if (event.type !== "status") return;
    if (activityClearTimerRef.current !== null) {
      window.clearTimeout(activityClearTimerRef.current);
      activityClearTimerRef.current = null;
    }

    if (event.phase === "tool_completed") {
      setExecutionActivities((current) => {
        const next = [...current];
        for (let index = next.length - 1; index >= 0; index -= 1) {
          const item = next[index];
          if (item?.status === "running" && item.toolName === event.toolName) {
            next[index] = { ...item, status: event.ok === false ? "error" : "done" };
            return next;
          }
        }
        return next;
      });
      return;
    }

    setExecutionActivities((current) => {
      const settled = current.map((item) => item.status === "running" && !item.toolName ? { ...item, status: "done" as const } : item);
      const last = settled[settled.length - 1];
      if (event.phase === "thinking" && last?.label === event.label && last.status === "running") return settled;
      activityCounterRef.current += 1;
      return [...settled.slice(-4), {
        id: activityCounterRef.current,
        label: event.label,
        toolName: event.toolName,
        status: "running" as const,
      }];
    });
  };

  const settleAndClearActivities = () => {
    setExecutionActivities((current) => current.map((item) => item.status === "running" ? { ...item, status: "done" as const } : item));
    activityClearTimerRef.current = window.setTimeout(() => setExecutionActivities([]), 2400);
  };


  useEffect(() => {
    let cancelled = false;
    const key = `gsw-chat-conversation:${account?.id ?? "none"}`;
    const savedId = sessionStorage.getItem(key);
    setConversationId(savedId);
    setMessages([]);
    setError("");
    setIntervention(null);
    setExecutionActivities([]);
    if (!savedId) { setConversationLoading(false); return () => { cancelled = true; }; }

    setConversationLoading(true);
    void api.chatConversation(savedId).then((detail) => {
      if (cancelled) return;
      const restored = detail.messages
        .filter((message) => message.role === "user" || message.role === "assistant")
        .map((message) => ({ role: message.role as "user" | "assistant", content: message.content }));
      setMessages(restored.slice(-24));
    }).catch(() => {
      if (!cancelled) {
        sessionStorage.removeItem(key);
        setConversationId(null);
      }
    }).finally(() => {
      if (!cancelled) setConversationLoading(false);
    });
    return () => {
      cancelled = true;
      if (activityClearTimerRef.current !== null) {
        window.clearTimeout(activityClearTimerRef.current);
        activityClearTimerRef.current = null;
      }
    };
  }, [account?.id]);

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
      setExecutionActivities([]);
      const response = await api.streamChat(account?.id ?? null, next, conversationId, handleStreamEvent);
      setConversationId(response.conversationId);
      sessionStorage.setItem(`gsw-chat-conversation:${account?.id ?? "none"}`, response.conversationId);
      setIntervention(response.intervention);
      const assistantMessage = response.message;
      if (assistantMessage) setMessages((current) => [...current, assistantMessage].slice(-24));
      if (response.intervention) setExecutionActivities([]);
      else settleAndClearActivities();
      window.requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }));
    } catch (err) {
      setExecutionActivities((current) => current.map((item) => item.status === "running" ? { ...item, status: "error" as const } : item));
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  };

  const resumeAfterIntervention = async () => {
    if (!account || !conversationId) return;
    setExecutionActivities([]);
    const response = await api.resumeChatStream(account.id, conversationId, handleStreamEvent);
    setIntervention(response.intervention);
    const assistantMessage = response.message;
    if (assistantMessage) setMessages((current) => [...current, assistantMessage].slice(-24));
    if (response.intervention) setExecutionActivities([]);
    else settleAndClearActivities();
    window.requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }));
  };

  const allowPermission = async () => {
    if (!account || !intervention || intervention.type !== "permission") return;
    setInterventionBusy(true);
    setError("");
    try {
      await api.grantChatPermission(account.id, intervention.scope);
      setIntervention(null);
      await resumeAfterIntervention();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setInterventionBusy(false);
    }
  };

  const decideConfirmation = async (decision: "approved" | "rejected") => {
    if (!intervention || intervention.type !== "confirmation") return;
    setInterventionBusy(true);
    setError("");
    try {
      await api.decideChatConfirmation(intervention.confirmationId, decision);
      setIntervention(null);
      if (decision === "approved") await resumeAfterIntervention();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setInterventionBusy(false);
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
      {(messages.length > 0 || conversationId) && <button className="gsw-chat-clear" type="button" onClick={() => { sessionStorage.removeItem(`gsw-chat-conversation:${account?.id ?? "none"}`); setConversationId(null); setMessages([]); setIntervention(null); setExecutionActivities([]); setInput(""); setError(""); }}><RefreshCcw size={15} /> New chat</button>}
    </header>

    <div className="gsw-chat-thread">
      {conversationLoading ? <div className="gsw-chat-empty"><span className="gsw-chat-empty-icon"><img className="gsw-chat-brand-logo" src="/logo.png" alt="" /></span><h3>Opening your chat…</h3><p>Restoring the conversation for this mailbox.</p></div> : visibleMessages.length === 0 ? <div className="gsw-chat-empty">
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
      {executionActivities.length > 0 && <section className="gsw-chat-execution" aria-live="polite">
        <div className="gsw-chat-execution-title">GSW is working</div>
        <div className="gsw-chat-execution-list">{executionActivities.map((activity) => <div className={`gsw-chat-execution-item ${activity.status}`} key={activity.id}>
          {activity.status === "running" ? <LoaderCircle size={14} className="gsw-chat-spin" /> : activity.status === "done" ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
          <span>{activity.label}</span>
        </div>)}</div>
      </section>}
      {sending && executionActivities.length === 0 && <article className="gsw-chat-message assistant gsw-chat-thinking"><div className="gsw-chat-message-label">GSW</div><div className="gsw-chat-thinking-dots" aria-label="Thinking"><span /><span /><span /></div></article>}
      {intervention && <section className="gsw-chat-intervention">
        <div className="gsw-chat-intervention-icon"><ShieldCheck size={19} strokeWidth={1.8} /></div>
        <div className="gsw-chat-intervention-copy">
          <strong>{intervention.type === "permission" ? intervention.title : "Confirm this action"}</strong>
          <p>{intervention.type === "permission" ? intervention.description : intervention.summary}</p>
          <div className="gsw-chat-intervention-actions">
            {intervention.type === "permission" ? <>
              <button type="button" className="primary" disabled={interventionBusy} onClick={() => void allowPermission()}><Check size={14} /> Allow</button>
              <button type="button" disabled={interventionBusy} onClick={() => setIntervention(null)}><X size={14} /> Not now</button>
            </> : <>
              <button type="button" className="primary" disabled={interventionBusy} onClick={() => void decideConfirmation("approved")}><Check size={14} /> Approve</button>
              <button type="button" disabled={interventionBusy} onClick={() => void decideConfirmation("rejected")}><X size={14} /> Don’t allow</button>
            </>}
          </div>
        </div>
      </section>}
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
      <p>Chat can read the selected mailbox and help draft or rewrite. It cannot take actions yet.</p>
    </footer>
  </div>;
}
