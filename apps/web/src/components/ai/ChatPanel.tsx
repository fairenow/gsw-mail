import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Archive, ArrowUp, Check, CheckCircle2, Clock3, Copy, LoaderCircle, Mic, RefreshCcw, ShieldCheck, Square, Trash2, X } from "lucide-react";
import { api, type AiChatMessage, type AiChatStreamEvent, type AiConversationRecord, type AiIntervention } from "../../api";
import { useAppShell } from "../AppShell";
import { ChatMarkdown } from "./ChatMarkdown";

const starterPrompts = [
  "Summarize yesterday's email activity",
  "Let me know what's scheduled for this week",
  "Coordinate my next campaign to my customer contacts",
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

type SpeechRecognitionResultLike = {
  isFinal: boolean;
  0: { transcript: string };
};

type SpeechRecognitionEventLike = {
  resultIndex?: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
};

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

const speechRecognitionConstructor = (): SpeechRecognitionConstructor | null => {
  const speechWindow = window as typeof window & {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null;
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
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [conversations, setConversations] = useState<AiConversationRecord[]>([]);
  const [intervention, setIntervention] = useState<AiIntervention | null>(null);
  const [interventionBusy, setInterventionBusy] = useState(false);
  const [executionActivities, setExecutionActivities] = useState<ExecutionActivity[]>([]);
  const activityCounterRef = useRef(0);
  const activityClearTimerRef = useRef<number | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [recording, setRecording] = useState(false);
  const [voiceStopping, setVoiceStopping] = useState(false);
  const [voiceLevels, setVoiceLevels] = useState<number[]>(() => Array.from({ length: 22 }, () => 0.14));
  const speechRef = useRef<SpeechRecognitionLike | null>(null);
  const speechBaseRef = useRef("");
  const speechTranscriptRef = useRef("");
  const sendAfterVoiceStopRef = useRef(false);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const waveformFrameRef = useRef<number | null>(null);
  const voiceFallbackTimerRef = useRef<number | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const voiceActive = recording || voiceStopping;
  const canSend = !sending && (voiceActive || input.trim().length > 0);
  const speechSupported = typeof window !== "undefined"
    && speechRecognitionConstructor() !== null
    && Boolean(navigator.mediaDevices?.getUserMedia);

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


  const cleanupVoiceAudio = () => {
    if (waveformFrameRef.current !== null) {
      window.cancelAnimationFrame(waveformFrameRef.current);
      waveformFrameRef.current = null;
    }
    if (voiceFallbackTimerRef.current !== null) {
      window.clearTimeout(voiceFallbackTimerRef.current);
      voiceFallbackTimerRef.current = null;
    }
    analyserRef.current?.disconnect();
    analyserRef.current = null;
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
    const audioContext = audioContextRef.current;
    audioContextRef.current = null;
    if (audioContext && audioContext.state !== "closed") void audioContext.close();
    setVoiceLevels(Array.from({ length: 22 }, () => 0.14));
  };

  const startWaveform = (stream: MediaStream) => {
    const audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 128;
    analyser.smoothingTimeConstant = 0.72;
    source.connect(analyser);
    audioContextRef.current = audioContext;
    analyserRef.current = analyser;
    const frequency = new Uint8Array(analyser.frequencyBinCount);

    const draw = () => {
      analyser.getByteFrequencyData(frequency);
      const bars = 22;
      const step = Math.max(1, Math.floor(frequency.length / bars));
      const next = Array.from({ length: bars }, (_, index) => {
        let total = 0;
        let count = 0;
        for (let offset = 0; offset < step; offset += 1) {
          const value = frequency[Math.min(frequency.length - 1, index * step + offset)] ?? 0;
          total += value;
          count += 1;
        }
        const normalized = count ? total / count / 255 : 0;
        return Math.min(1, Math.max(0.12, normalized * 1.35));
      });
      setVoiceLevels(next);
      waveformFrameRef.current = window.requestAnimationFrame(draw);
    };
    draw();
  };

  const currentVoiceContent = () => `${speechBaseRef.current}${speechTranscriptRef.current}`.trim();

  const finalizeVoice = () => {
    const content = currentVoiceContent();
    setInput(content);
    setRecording(false);
    setVoiceStopping(false);
    speechRef.current = null;
    cleanupVoiceAudio();
    const shouldSend = sendAfterVoiceStopRef.current;
    sendAfterVoiceStopRef.current = false;
    if (shouldSend) {
      if (content) {
        void submitContent(content);
      } else {
        setError("I didn’t catch any speech. Try again and speak after the waveform starts moving.");
      }
    }
  };

  const stopVoice = (sendWhenReady = false) => {
    if (!voiceActive) return;
    if (sendWhenReady) sendAfterVoiceStopRef.current = true;
    if (voiceStopping) return;
    setVoiceStopping(true);
    setRecording(false);
    try {
      speechRef.current?.stop();
    } catch {
      finalizeVoice();
      return;
    }
    voiceFallbackTimerRef.current = window.setTimeout(() => finalizeVoice(), 1200);
  };

  const startVoice = async () => {
    if (sending || voiceActive) return;
    const Recognition = speechRecognitionConstructor();
    if (!Recognition || !navigator.mediaDevices?.getUserMedia) {
      setError("Voice dictation is not supported in this browser.");
      return;
    }

    setError("");
    speechTranscriptRef.current = "";
    sendAfterVoiceStopRef.current = false;
    const base = input.trimEnd();
    speechBaseRef.current = base ? `${base} ` : "";

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      startWaveform(stream);

      const recognition = new Recognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = navigator.language || "en-US";
      recognition.onresult = (event) => {
        let finalText = "";
        let interimText = "";
        for (let index = 0; index < event.results.length; index += 1) {
          const result = event.results[index];
          const transcript = result?.[0]?.transcript ?? "";
          if (result?.isFinal) finalText += `${transcript} `;
          else interimText += transcript;
        }
        speechTranscriptRef.current = `${finalText}${interimText}`.trim();
      };
      recognition.onerror = (event) => {
        if (event.error === "not-allowed" || event.error === "service-not-allowed") {
          setError("Microphone or speech-recognition access was blocked. Allow microphone access in Chrome and try again.");
        } else if (event.error !== "no-speech" && event.error !== "aborted") {
          setError("Voice dictation stopped unexpectedly. Any recognized text has been kept.");
        }
      };
      recognition.onend = finalizeVoice;
      speechRef.current = recognition;
      setVoiceStopping(false);
      setRecording(true);
      recognition.start();
    } catch (err) {
      cleanupVoiceAudio();
      setRecording(false);
      setVoiceStopping(false);
      const name = err instanceof DOMException ? err.name : "";
      setError(name === "NotAllowedError"
        ? "Microphone access was blocked. Allow microphone access for GSW Mail in Chrome and try again."
        : "GSW Mail could not start the microphone. Check your browser microphone settings and try again.");
    }
  };


  useEffect(() => {
    let cancelled = false;
    const key = `gsw-chat-conversation:${account?.id ?? "none"}`;
    const savedId = localStorage.getItem(key);
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
        localStorage.removeItem(key);
        setConversationId(null);
      }
    }).finally(() => {
      if (!cancelled) setConversationLoading(false);
    });
    return () => {
      cancelled = true;
      speechRef.current?.abort();
      speechRef.current = null;
      cleanupVoiceAudio();
      if (activityClearTimerRef.current !== null) {
        window.clearTimeout(activityClearTimerRef.current);
        activityClearTimerRef.current = null;
      }
    };
  }, [account?.id]);

  const refreshConversations = async () => {
    setHistoryLoading(true);
    try {
      const response = await api.chatConversations();
      setConversations(response.conversations);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setHistoryLoading(false);
    }
  };

  const openConversation = async (id: string) => {
    setConversationLoading(true);
    setError("");
    try {
      const detail = await api.chatConversation(id);
      const restored = detail.messages
        .filter((message) => message.role === "user" || message.role === "assistant")
        .map((message) => ({ role: message.role as "user" | "assistant", content: message.content }));
      setConversationId(id);
      setMessages(restored.slice(-24));
      setIntervention(null);
      setExecutionActivities([]);
      localStorage.setItem(`gsw-chat-conversation:${account?.id ?? "none"}`, id);
      setHistoryOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setConversationLoading(false);
    }
  };

  const archiveConversation = async (id: string) => {
    try {
      await api.updateChatConversation(id, { status: "archived" });
      if (conversationId === id) {
        localStorage.removeItem(`gsw-chat-conversation:${account?.id ?? "none"}`);
        setConversationId(null);
        setMessages([]);
        setIntervention(null);
      }
      await refreshConversations();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const deleteConversation = async (id: string) => {
    if (!window.confirm("Delete this chat permanently?")) return;
    try {
      await api.deleteChatConversation(id);
      if (conversationId === id) {
        localStorage.removeItem(`gsw-chat-conversation:${account?.id ?? "none"}`);
        setConversationId(null);
        setMessages([]);
        setIntervention(null);
      }
      await refreshConversations();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const submitContent = async (contentOverride: string) => {
    const content = contentOverride.trim();
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
      localStorage.setItem(`gsw-chat-conversation:${account?.id ?? "none"}`, response.conversationId);
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

  const send = async () => {
    if (voiceActive) {
      stopVoice(true);
      return;
    }
    await submitContent(input);
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
      const result = await api.decideChatConfirmation(intervention.confirmationId, decision);
      setIntervention(null);
      if (result.execution?.message) {
        setMessages((current) => [...current, result.execution.message].slice(-24));
      }
      setExecutionActivities([]);
      window.requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }));
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
      <div className="gsw-chat-header-actions">
        <button className="gsw-chat-clear" type="button" onClick={() => { setHistoryOpen((current) => !current); if (!historyOpen) void refreshConversations(); }}><Clock3 size={15} /> History</button>
        {(messages.length > 0 || conversationId) && <button className="gsw-chat-clear" type="button" onClick={() => { localStorage.removeItem(`gsw-chat-conversation:${account?.id ?? "none"}`); setConversationId(null); setMessages([]); setIntervention(null); setExecutionActivities([]); setInput(""); setError(""); }}><RefreshCcw size={15} /> New chat</button>}
      </div>
    </header>

    {historyOpen && <aside className="gsw-chat-history" aria-label="Chat history">
      <div className="gsw-chat-history-head">
        <div><strong>Chat history</strong><span>Saved to your GSW account</span></div>
        <button type="button" className="gsw-chat-copy" aria-label="Close chat history" onClick={() => setHistoryOpen(false)}><X size={15} /></button>
      </div>
      <div className="gsw-chat-history-list">
        {historyLoading ? <div className="gsw-chat-history-empty">Loading chats…</div> : conversations.length === 0 ? <div className="gsw-chat-history-empty">No saved chats yet.</div> : conversations.map((conversation) => <div className={`gsw-chat-history-item ${conversation.id === conversationId ? "active" : ""} ${conversation.status === "archived" ? "archived" : ""}`} key={conversation.id}>
          <button type="button" className="gsw-chat-history-open" onClick={() => void openConversation(conversation.id)}>
            <strong>{conversation.title || "New chat"}</strong>
            <span>{new Date(conversation.lastMessageAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}{conversation.status === "archived" ? " · Archived" : ""}</span>
          </button>
          <div className="gsw-chat-history-actions">
            {conversation.status !== "archived" && <button type="button" title="Archive chat" aria-label="Archive chat" onClick={() => void archiveConversation(conversation.id)}><Archive size={14} /></button>}
            <button type="button" title="Delete chat" aria-label="Delete chat" onClick={() => void deleteConversation(conversation.id)}><Trash2 size={14} /></button>
          </div>
        </div>)}
      </div>
    </aside>}
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
              : <div className="gsw-chat-message-body" key={`text-${segmentIndex}`}><ChatMarkdown content={segment.content} /></div>)}
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
      <div className={`gsw-chat-composer-box ${voiceActive ? "voice-active" : ""}`}>
        {voiceActive ? <div className="gsw-chat-waveform" role="status" aria-live="polite" aria-label={voiceStopping ? "Finishing voice transcription" : "Recording voice prompt"}>
          <span className="gsw-chat-waveform-status">{voiceStopping ? "Finishing…" : "Listening"}</span>
          <span className="gsw-chat-waveform-bars" aria-hidden="true">
            {voiceLevels.map((level, index) => <span key={index} style={{ height: `${Math.round(6 + level * 26)}px` }} />)}
          </span>
        </div> : <textarea
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
        />}
        <button
          className={`gsw-chat-voice ${recording ? "recording" : ""}`}
          type="button"
          aria-label={voiceActive ? "Stop voice dictation and review" : "Start voice dictation"}
          title={voiceActive ? "Stop and review" : speechSupported ? "Dictate a prompt" : "Voice dictation is unavailable in this browser"}
          disabled={!speechSupported || sending || voiceStopping}
          onClick={voiceActive ? () => stopVoice(false) : () => void startVoice()}
        >{voiceActive ? <Square size={15} fill="currentColor" /> : <Mic size={17} strokeWidth={2} />}</button>
        <button className="gsw-chat-send" type="button" aria-label={voiceActive ? "Send voice prompt now" : "Send message"} disabled={!canSend} onClick={() => void send()}><ArrowUp size={18} strokeWidth={2} /></button>
      </div>
      <p>{voiceActive ? "Speak naturally. Tap stop to review the transcript, or tap send to submit it immediately." : "Chat can search mail and saved chats, manage drafts, and create scheduled work. Sending still requires explicit confirmation."}</p>
    </footer>
  </div>;
}
