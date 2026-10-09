import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Archive, ArrowUp, Check, CheckCircle2, Clock3, Copy, File, LoaderCircle, Mic, Paperclip, RefreshCcw, ShieldCheck, Square, Trash2, X } from "lucide-react";
import { api, type AiChatAttachment, type AiChatMessage, type AiChatStreamEvent, type AiConversationRecord, type AiIntervention } from "../../api";
import { useAppShell } from "../AppShell";
import { ChatMarkdown } from "./ChatMarkdown";
import { ChatImageAttachment, isChatImage } from "./ChatImageAttachment";

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

const attachmentsFromMetadata = (metadata: Record<string, unknown> | null | undefined): AiChatAttachment[] => {
  const items = Array.isArray(metadata?.attachments) ? metadata.attachments : [];
  return items.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const value = item as Record<string, unknown>;
    if (typeof value.assetId !== "string" || typeof value.filename !== "string") return [];
    return [{
      assetId: value.assetId,
      filename: value.filename,
      mimeType: typeof value.mimeType === "string" ? value.mimeType : "application/octet-stream",
      sizeBytes: typeof value.sizeBytes === "number" ? value.sizeBytes : Number(value.sizeBytes ?? 0),
      kind: typeof value.kind === "string" ? value.kind : null,
    }];
  });
};

const formatAttachmentSize = (size: number) =>
  size < 1024 ? `${size} B`
    : size < 1024 * 1024 ? `${(size / 1024).toFixed(size < 10 * 1024 ? 1 : 0)} KB`
      : `${(size / (1024 * 1024)).toFixed(size < 10 * 1024 * 1024 ? 1 : 0)} MB`;

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
  const [activityCollapsed, setActivityCollapsed] = useState(false);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [failedTurn, setFailedTurn] = useState<AiChatMessage | null>(null);
  const [retryResume, setRetryResume] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<AiChatAttachment[]>([]);
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const [dropActive, setDropActive] = useState(false);
  const dragDepthRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null);
  const [recording, setRecording] = useState(false);
  const [voiceLevel, setVoiceLevel] = useState(0);
  const speechRef = useRef<SpeechRecognitionLike | null>(null);
  const speechBaseRef = useRef("");
  const speechTranscriptRef = useRef("");
  const sendVoiceOnEndRef = useRef(false);
  const voiceStreamRef = useRef<MediaStream | null>(null);
  const voiceAudioContextRef = useRef<AudioContext | null>(null);
  const voiceAnimationFrameRef = useRef<number | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const canSend = (input.trim().length > 0 || pendingAttachments.length > 0 || recording) && !sending && !uploadingFiles;
  const speechSupported = typeof window !== "undefined" && speechRecognitionConstructor() !== null;

  const visibleMessages = useMemo(() => messages, [messages]);

  const scrollToLatestMessage = (behavior: ScrollBehavior = "auto") => {
    window.requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ behavior, block: "end" });
    });
  };

  const resizeComposerInput = (element: HTMLTextAreaElement) => {
    element.style.height = "0px";
    const computed = window.getComputedStyle(element);
    const lineHeight = Number.parseFloat(computed.lineHeight) || 20;
    const paddingTop = Number.parseFloat(computed.paddingTop) || 0;
    const paddingBottom = Number.parseFloat(computed.paddingBottom) || 0;
    const oneLine = lineHeight + paddingTop + paddingBottom;
    const maxHeight = lineHeight * 3 + paddingTop + paddingBottom;
    const nextHeight = Math.min(Math.max(element.scrollHeight, oneLine), maxHeight);
    element.style.height = `${nextHeight}px`;
    element.style.overflowY = element.scrollHeight > maxHeight ? "auto" : "hidden";
  };

  useEffect(() => {
    if (!recording && composerInputRef.current) resizeComposerInput(composerInputRef.current);
  }, [input, recording]);

  useEffect(() => {
    if (conversationLoading || messages.length === 0) return;
    scrollToLatestMessage("auto");
  }, [conversationId, conversationLoading]);

  const handleStreamEvent = (event: AiChatStreamEvent) => {
    if (event.type !== "status") return;


    if (event.phase === "tool_completed") {
      if (event.toolName?.startsWith("tasks.")) window.dispatchEvent(new Event("gsw-agent-task-changed"));
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

    setActivityCollapsed(false);
    setExecutionActivities((current) => {
      const settled = current.map((item) => item.status === "running" && !item.toolName ? { ...item, status: "done" as const } : item);
      const last = settled[settled.length - 1];
      if (last?.label === event.label && last.status === "running" && last.toolName === event.toolName) return settled;
      activityCounterRef.current += 1;
      return [...settled.slice(-39), {
        id: activityCounterRef.current,
        label: event.phase === "thinking" ? "Preparing response" : "Working on your request",
        toolName: event.toolName,
        status: "running" as const,
      }];
    });
  };

  const settleAndClearActivities = () => {
    setExecutionActivities((current) => current.map((item) => item.status === "running" ? { ...item, status: "done" as const } : item));
    setActivityCollapsed(true);
  };


  const stopVoiceVisualizer = () => {
    if (voiceAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(voiceAnimationFrameRef.current);
      voiceAnimationFrameRef.current = null;
    }
    voiceStreamRef.current?.getTracks().forEach((track) => track.stop());
    voiceStreamRef.current = null;
    if (voiceAudioContextRef.current) {
      void voiceAudioContextRef.current.close().catch(() => undefined);
      voiceAudioContextRef.current = null;
    }
    setVoiceLevel(0);
  };

  const startVoiceVisualizer = async () => {
    if (!navigator.mediaDevices?.getUserMedia) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!speechRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const AudioContextCtor = window.AudioContext;
      const audioContext = new AudioContextCtor();
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.78;
      audioContext.createMediaStreamSource(stream).connect(analyser);
      voiceStreamRef.current = stream;
      voiceAudioContextRef.current = audioContext;
      const data = new Uint8Array(analyser.frequencyBinCount);
      let lastPaint = 0;
      const paint = (now: number) => {
        analyser.getByteTimeDomainData(data);
        if (now - lastPaint > 70) {
          let sum = 0;
          for (const sample of data) {
            const centered = (sample - 128) / 128;
            sum += centered * centered;
          }
          setVoiceLevel(Math.min(1, Math.sqrt(sum / data.length) * 5.5));
          lastPaint = now;
        }
        voiceAnimationFrameRef.current = window.requestAnimationFrame(paint);
      };
      voiceAnimationFrameRef.current = window.requestAnimationFrame(paint);
    } catch {
      // SpeechRecognition can still work even when the visualizer stream is unavailable.
    }
  };

  const stopVoice = () => {
    if (!speechRef.current) return;
    sendVoiceOnEndRef.current = false;
    speechRef.current.stop();
  };

  const startVoice = () => {
    if (sending || recording) return;
    const Recognition = speechRecognitionConstructor();
    if (!Recognition) {
      setError("Voice dictation is not supported in this browser.");
      return;
    }

    setError("");
    const recognition = new Recognition();
    const base = input.trimEnd();
    speechBaseRef.current = base ? `${base} ` : "";
    speechTranscriptRef.current = speechBaseRef.current.trimEnd();
    sendVoiceOnEndRef.current = false;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language || "en-US";
    recognition.onresult = (event) => {
      let transcript = "";
      for (let index = 0; index < event.results.length; index += 1) {
        transcript += event.results[index]?.[0]?.transcript ?? "";
      }
      const nextInput = `${speechBaseRef.current}${transcript}`.trimStart();
      speechTranscriptRef.current = nextInput;
      setInput(nextInput);
    };
    recognition.onerror = (event) => {
      const message = event.error === "not-allowed"
        ? "Microphone access was blocked. Allow microphone access in your browser and try again."
        : event.error === "no-speech"
          ? "I didn't catch any speech. Tap the microphone and try again."
          : "Voice dictation stopped unexpectedly. You can keep editing the text that was captured.";
      setError(message);
      sendVoiceOnEndRef.current = false;
      setRecording(false);
      speechRef.current = null;
      stopVoiceVisualizer();
    };
    recognition.onend = () => {
      const shouldSend = sendVoiceOnEndRef.current;
      const captured = speechTranscriptRef.current.trim();
      sendVoiceOnEndRef.current = false;
      setRecording(false);
      speechRef.current = null;
      stopVoiceVisualizer();
      setInput(captured);
      if (shouldSend) {
        if (captured) void send(captured);
        else setError("I didn't catch any speech to send. Try dictating again.");
      }
    };
    speechRef.current = recognition;
    setRecording(true);
    recognition.start();
    void startVoiceVisualizer();
  };


  useEffect(() => {
    let cancelled = false;
    const key = `gsw-chat-conversation:${account?.id ?? "none"}`;
    const savedId = localStorage.getItem(key);
    setConversationId(savedId);
    setMessages([]);
    setPendingAttachments([]);
    setError("");
    setIntervention(null);
    setExecutionActivities([]);
    if (!savedId) { setConversationLoading(false); return () => { cancelled = true; }; }

    setConversationLoading(true);
    void api.chatConversation(savedId).then((detail) => {
      if (cancelled) return;
      const restored = detail.messages
        .filter((message) => message.role === "user" || message.role === "assistant")
        .map((message) => ({
          role: message.role as "user" | "assistant",
          content: message.content,
          attachments: attachmentsFromMetadata(message.metadata),
        }));
      setMessages(restored.slice(-24));
      scrollToLatestMessage("auto");
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
      stopVoiceVisualizer();
  
    };
  }, [account?.id]);

  const refreshConversations = async () => {
    setHistoryLoading(true);
    try {
      const response = await api.chatConversations();
      setConversations(response.conversations);
    } catch (err) {
      setError("Couldn’t complete the action. Please try again.");
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
        .map((message) => ({
          role: message.role as "user" | "assistant",
          content: message.content,
          attachments: attachmentsFromMetadata(message.metadata),
        }));
      setConversationId(id);
      setMessages(restored.slice(-24));
      setIntervention(null);
      scrollToLatestMessage("auto");
      setExecutionActivities([]);
      localStorage.setItem(`gsw-chat-conversation:${account?.id ?? "none"}`, id);
      setHistoryOpen(false);
    } catch (err) {
      setError("Couldn’t complete the action. Please try again.");
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
      setError("Couldn’t complete the action. Please try again.");
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
      setError("Couldn’t complete the action. Please try again.");
    }
  };

  const uploadChatFiles = async (files: FileList | File[]) => {
    const incoming = Array.from(files);
    const remaining = Math.max(0, 10 - pendingAttachments.length);
    if (incoming.length > remaining) { setError("A chat can have up to 10 attachments. Remove a file before adding more."); return; }
    const supported = /\.(pdf|doc|docx|txt|md|csv|json|png|jpe?g|gif|webp|xlsx|xls|pptx|ppt)$/i;
    const unsupported = incoming.find((file) => !supported.test(file.name));
    if (unsupported) { setError(unsupported.name + " is not a supported attachment type."); return; }
    const oversized = incoming.find((file) => file.size > 25 * 1024 * 1024);
    if (oversized) { setError(oversized.name + " exceeds the 25 MB attachment limit."); return; }
    const selected = incoming;
    if (!selected.length) return;
    setUploadingFiles(true);
    setError("");
    try {
      const uploaded: AiChatAttachment[] = [];
      for (const file of selected) {
        const result = await api.uploadFile(file, { source: "chat_upload", kind: file.type.startsWith("image/") ? "image" : undefined });
        uploaded.push({
          assetId: result.asset.id,
          filename: result.asset.displayName || result.asset.filename,
          mimeType: result.asset.mimeType,
          sizeBytes: result.asset.sizeBytes,
          kind: result.asset.kind,
        });
      }
      setPendingAttachments((current) => [...current, ...uploaded].slice(0, 10));
    } catch (err) {
      setError("Couldn’t complete the action. Please try again.");
    } finally {
      setUploadingFiles(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const useImageInEmail = (attachment: AiChatAttachment) => {
    setPendingAttachments((current) => current.some((item) => item.assetId === attachment.assetId) ? current : [...current, attachment].slice(0, 10));
    setInput((current) => current.trim() || `Please create an email draft using the attached image "${attachment.filename}". Ask me for recipients, subject, and any missing details. Do not send the email.`);
    composerInputRef.current?.focus();
    scrollToLatestMessage("smooth");
  };

  const openAttachedFile = async (attachment: AiChatAttachment) => {
    try {
      const result = await api.fileDownload(attachment.assetId);
      window.open(result.url, "_blank", "noopener,noreferrer");
    } catch (err) {
      setError("Couldn’t complete the action. Please try again.");
    }
  };

  async function send(override?: string) {
    if (recording && speechRef.current) {
      sendVoiceOnEndRef.current = true;
      speechRef.current.stop();
      return;
    }
    const typedContent = (override ?? input).trim();
    if (override && failedTurn && executionActivities.some((item) => item.status === "done" && item.toolName && /^(?:mail\\.|campaign\\.|calendar\\.|contacts\\.|automations\\.|files\\.)/.test(item.toolName)) && !window.confirm("Some operations may already have completed. Check the results before retrying to avoid duplicates. Retry anyway?")) return;
    const attachmentsForTurn = override && failedTurn ? failedTurn.attachments ?? [] : pendingAttachments;
    const content = typedContent || (attachmentsForTurn.length > 1 ? "Please review the attached files." : "Please review the attached file.");
    if ((!typedContent && attachmentsForTurn.length === 0) || sending || uploadingFiles) return;
    const userMessage: AiChatMessage = { role: "user", content, attachments: attachmentsForTurn };
    const next = [...(override && failedTurn ? messages.slice(0, -1) : messages), userMessage].slice(-23);
    setMessages(next);
    setInput("");
    setPendingAttachments([]);
    setError("");
    setFailedTurn(null);
    setRetryResume(false);
    setSending(true);
    scrollToLatestMessage("smooth");
    try {
      setExecutionActivities([]);
      setActivityCollapsed(false);
      const response = await api.streamChat(account?.id ?? null, next, conversationId, handleStreamEvent, attachmentsForTurn.map((item) => item.assetId));
      setConversationId(response.conversationId);
      localStorage.setItem(`gsw-chat-conversation:${account?.id ?? "none"}`, response.conversationId);
      setIntervention(response.intervention);
      const assistantMessage = response.message;
      if (assistantMessage?.content?.trim() === "Failed to respond. Please retry.") {
        setFailedTurn(userMessage);
        setError("Failed to respond.");
      } else if (assistantMessage) setMessages((current) => [...current, assistantMessage].slice(-24));
      if (assistantMessage?.attachments?.some(isChatImage)) setActivityCollapsed(true);
      if (response.intervention) setActivityCollapsed(true);
      else settleAndClearActivities();
      scrollToLatestMessage("smooth");
    } catch (err) {
      setExecutionActivities((current) => current.map((item) => item.status === "running" ? { ...item, status: "error" as const } : item));
      setActivityCollapsed(true);
      setPendingAttachments((current) => current.length ? current : attachmentsForTurn);
      console.error("[gsw-chat] Failed to respond", { errorType: err instanceof Error ? err.name : "unknown" });
      setFailedTurn(userMessage);
      setError("Failed to respond.");
    } finally {
      setSending(false);
    }
  }

  const resumeAfterIntervention = async () => {
    if (!account || !conversationId || sending) return;
    setSending(true);
    setError("");
    setRetryResume(false);
    setExecutionActivities([]);
    try {
      const response = await api.resumeChatStream(account.id, conversationId, handleStreamEvent);
      setIntervention(response.intervention);
      const assistantMessage = response.message;
      if (assistantMessage?.content?.trim() === "Failed to respond. Please retry.") {
        setError("Failed to respond.");
        setRetryResume(true);
      } else if (assistantMessage) {
        setMessages((current) => [...current, assistantMessage].slice(-24));
      }
      if (response.intervention) setActivityCollapsed(true);
      else settleAndClearActivities();
      scrollToLatestMessage("smooth");
    } catch (error) {
      console.error("[gsw-chat] Failed to resume response", { errorType: error instanceof Error ? error.name : "unknown" });
      setError("Failed to respond.");
      setRetryResume(true);
    } finally {
      setSending(false);
    }
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
      setError("Couldn’t complete the action. Please try again.");
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
      scrollToLatestMessage("smooth");
    } catch (err) {
      setError("Couldn’t complete the action. Please try again.");
    } finally {
      setInterventionBusy(false);
    }
  };

  const containsFiles = (event: React.DragEvent) => Array.from(event.dataTransfer.types).includes("Files");
  const onChatDragEnter = (event: React.DragEvent) => {
    if (!containsFiles(event)) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    if (!sending && !uploadingFiles) setDropActive(true);
  };
  const onChatDragLeave = (event: React.DragEvent) => {
    if (!containsFiles(event)) return;
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (!dragDepthRef.current) setDropActive(false);
  };
  const onChatDrop = (event: React.DragEvent) => {
    if (!containsFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = 0;
    setDropActive(false);
    if (!sending && !uploadingFiles && event.dataTransfer.files.length) void uploadChatFiles(event.dataTransfer.files);
  };

  return <div className="gsw-chat-panel" onDragEnter={onChatDragEnter}
    onDragOver={(event) => { if (containsFiles(event)) { event.preventDefault(); event.dataTransfer.dropEffect = sending || uploadingFiles ? "none" : "copy"; } }}
    onDragLeave={onChatDragLeave} onDrop={onChatDrop}>
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
        {(messages.length > 0 || conversationId) && <button className="gsw-chat-clear" type="button" onClick={() => { localStorage.removeItem(`gsw-chat-conversation:${account?.id ?? "none"}`); setConversationId(null); setMessages([]); setPendingAttachments([]); setIntervention(null); setExecutionActivities([]); setInput(""); setError(""); }}><RefreshCcw size={15} /> New chat</button>}
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
          {message.attachments && message.attachments.length > 0 && <div className="gsw-chat-message-files">
            {message.attachments.map((attachment) => isChatImage(attachment)
              ? <ChatImageAttachment key={attachment.assetId} attachment={attachment} onUseInEmail={useImageInEmail} onError={setError} />
              : <button type="button" className="gsw-chat-file-chip" key={attachment.assetId} onClick={() => void openAttachedFile(attachment)}>
                <File size={15} />
                <span><strong>{attachment.filename}</strong><small>{attachment.mimeType || "File"} · {formatAttachmentSize(attachment.sizeBytes)}</small></span>
              </button>)}
          </div>}
          <button className="gsw-chat-copy" type="button" aria-label={message.role === "user" ? "Copy prompt" : "Copy full response"} title={message.role === "user" ? "Copy prompt" : "Copy full response"} onClick={() => void navigator.clipboard.writeText(message.role === "assistant" ? cleanAssistantText(message.content) : message.content)}><Copy size={14} strokeWidth={1.8} /></button>
        </article>;
      })}
      {executionActivities.length > 0 && <section className="gsw-chat-execution" aria-live="polite">
        <button type="button" className="gsw-chat-execution-toggle" aria-expanded={!activityCollapsed}
          onClick={() => setActivityCollapsed((collapsed) => !collapsed)}>
          <span className="gsw-chat-execution-title">{sending ? "GSW is working" : executionActivities.some((activity) => activity.status === "error") ? "Work completed with issues" : "Work history"}</span>
          <span className="gsw-chat-execution-toggle-hint">{activityCollapsed ? "Show details ▾" : "Hide details ▴"}</span>
        </button>
        {!activityCollapsed && <div className="gsw-chat-execution-list">{executionActivities.map((activity) => <div className={`gsw-chat-execution-item ${activity.status}`} key={activity.id}>
          {activity.status === "running" ? <LoaderCircle size={14} className="gsw-chat-spin" /> : activity.status === "done" ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
          <span>{activity.label}</span>
        </div>)}</div>}
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
      {error && <div className="gsw-chat-error" role="alert">{failedTurn || retryResume ? "Failed to respond." : error}{(failedTurn || retryResume) && <button type="button" disabled={sending} onClick={() => retryResume ? void resumeAfterIntervention() : failedTurn ? void send(failedTurn.content) : undefined}>Retry</button>}</div>}
      <div ref={bottomRef} />
    </div>

    {dropActive && <div className="gsw-chat-drop-overlay" role="status" aria-live="polite">
      <div className="gsw-chat-drop-card"><Paperclip size={30} /><strong>Drop files to attach</strong>
      <span>Release files anywhere in GSW Chat. Nothing will be sent until you choose Send.</span></div>
    </div>}
    <footer className="gsw-chat-composer">
      <div
        className={`gsw-chat-composer-box ${recording ? "voice-active" : ""}`}
      >
        <input ref={fileInputRef} className="gsw-hidden-input" type="file" multiple onChange={(event) => event.target.files && void uploadChatFiles(event.target.files)} />
        {pendingAttachments.length > 0 && <div className="gsw-chat-pending-files">
          {pendingAttachments.map((attachment) => <span className="gsw-chat-pending-file" key={attachment.assetId}>
            <File size={14} />
            <span><strong>{attachment.filename}</strong><small>{formatAttachmentSize(attachment.sizeBytes)}</small></span>
            <button type="button" aria-label={`Remove ${attachment.filename}`} onClick={() => setPendingAttachments((current) => current.filter((item) => item.assetId !== attachment.assetId))}><X size={13} /></button>
          </span>)}
        </div>}
        {recording ? <div className="gsw-chat-voice-live" aria-live="polite" aria-label="Microphone is recording">
          <span className="gsw-chat-recording-dot" />
          <span className="gsw-chat-listening-label">Listening</span>
          <div className="gsw-chat-waveform" aria-hidden="true">
            {[0.52, 0.76, 0.61, 0.96, 0.72, 1.18, 0.82, 1.04, 0.66, 0.92, 0.58, 1.1, 0.74, 0.88, 0.55, 0.98, 0.69].map((multiplier, index) => (
              <span key={index} style={{ height: `${Math.max(4, Math.round(5 + voiceLevel * multiplier * 20))}px` }} />
            ))}
          </div>
        </div> : <textarea
          ref={composerInputRef}
          value={input}
          aria-label="Message GSW Chat"
          onChange={(event) => {
            setInput(event.target.value);
            resizeComposerInput(event.currentTarget);
          }}
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
          className="gsw-chat-attach"
          type="button"
          aria-label="Attach files"
          title="Attach files"
          disabled={sending || uploadingFiles || pendingAttachments.length >= 10}
          onClick={() => fileInputRef.current?.click()}
        >{uploadingFiles ? <LoaderCircle size={17} className="gsw-chat-spin" /> : <Paperclip size={17} strokeWidth={2} />}</button>
        <button
          className={`gsw-chat-voice ${recording ? "recording" : ""}`}
          type="button"
          aria-label={recording ? "Stop voice dictation" : "Start voice dictation"}
          title={recording ? "Stop and review" : speechSupported ? "Dictate a prompt" : "Voice dictation is unavailable in this browser"}
          disabled={!speechSupported || sending}
          onClick={recording ? stopVoice : startVoice}
        >{recording ? <Square size={15} fill="currentColor" /> : <Mic size={17} strokeWidth={2} />}</button>
        <button className="gsw-chat-send" type="button" aria-label={recording ? "Stop dictation and send" : "Send message"} title={recording ? "Send what you've dictated" : "Send message"} disabled={!canSend} onClick={() => void send()}><ArrowUp size={18} strokeWidth={2} /></button>
      </div>
      <p>{recording ? "Listening… tap stop to review your words, or send when you're done." : uploadingFiles ? "Uploading file to your private GSW Files storage…" : "Attach files or drag them here. GSW Chat can use stored files in drafts; sending still requires explicit confirmation."}</p>
    </footer>
  </div>;
}
