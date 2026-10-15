import type { AgentToolDefinition } from "./types.js";
import { createMailService } from "../../services/mailService.js";
import { reportChatError } from "../chatSafeErrors.js";
import { z } from "zod";

const inputSchema = z.object({
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(50).default(30),
});

type MailRow = {
  messageId: string; threadId?: string | null; subject?: string | null;
  date: string | Date; from: unknown; to: unknown; snippet?: string | null;
  read?: boolean; direction: string;
};
type FolderRow = { role?: string | null; mailbox: string; complete: boolean; messages: MailRow[] };
type Activity = { complete: boolean; folders: FolderRow[]; missingRequiredMailboxes?: string[] };

export function buildInboxTriage(activity: Activity) {
  const inbox = activity.folders.filter(f => f.role?.toLowerCase() === "inbox" || f.mailbox.toLowerCase() === "inbox");
  const sent = activity.folders.filter(f => f.role?.toLowerCase() === "sent" || f.mailbox.toLowerCase() === "sent");
  const byThread = new Map<string, { inbox: MailRow[]; sent: MailRow[] }>();
  const keyFor = (m: MailRow) => m.threadId || `message:${m.messageId}`;
  for (const folder of inbox) for (const message of folder.messages) {
    const key = keyFor(message);
    const group = byThread.get(key) ?? { inbox: [], sent: [] };
    group.inbox.push(message); byThread.set(key, group);
  }
  for (const folder of sent) for (const message of folder.messages) {
    const key = keyFor(message);
    const group = byThread.get(key) ?? { inbox: [], sent: [] };
    group.sent.push(message); byThread.set(key, group);
  }
  const candidates = [...byThread.entries()].flatMap(([threadId, group]) => {
    if (!group.inbox.length) return [];
    const rows = [...group.inbox, ...group.sent].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    const latest = rows[0]!;
    const latestInbox = [...group.inbox].sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0]!;
    const inbound = group.inbox.filter(m => m.direction === "inbound");
    const outgoing = rows.filter(m => m.direction === "outbound" || m.direction === "outbound_copy");
    if (!inbound.length && !outgoing.length) return [];
    const status = latest.direction === "inbound"
      ? "potential_reply_needed"
      : "waiting_or_followup_candidate";
    return [{
      threadId, status, latestDate: new Date(latest.date).toISOString(),
      from: latestInbox.from, subject: latestInbox.subject, snippet: latestInbox.snippet,
      read: latestInbox.read, inboxMessages: group.inbox.length, sentMessages: group.sent.length,
      latestMessageId: latest.messageId,
      // A missing Sent match cannot prove that no reply was sent through another account.
      requiresThreadReview: true,
    }];
  }).sort((a,b) => b.latestDate.localeCompare(a.latestDate));
  return {
    scannedInboxMessages: inbox.reduce((s,f) => s + f.messages.length, 0),
    scannedSentMessages: sent.reduce((s,f) => s + f.messages.length, 0),
    complete: activity.complete && inbox.length > 0 && sent.length > 0
      && inbox.every(f=>f.complete) && sent.every(f=>f.complete),
    incompleteReason: activity.complete ? undefined : "Mailbox scan reached a page limit or a requested folder was unavailable.",
    candidateCount: candidates.length,
    candidates,
  };
}

export const mailTriageTool: AgentToolDefinition = {
  name: "mail.triage",
  description: "Scan Inbox and Sent across all dates, group messages into candidate conversations and report verified coverage. Use for whole-inbox unanswered-mail requests instead of mail.search. Results are preliminary; inspect threads to confirm whether a human reply is necessary. Request additional offsets until all candidates are reviewed. Never claim complete coverage when complete=false.",
  inputSchema: {
    type: "object",
    properties: {
      offset: { type: "integer", minimum: 0, description: "Candidate offset, starting at zero." },
      limit: { type: "integer", minimum: 1, maximum: 50, description: "Maximum candidate conversations to return (default 30)." },
    },
    additionalProperties: false,
  },
  requiredScopes: ["mail.read"],
  risk: "read",
  async execute(ctx, rawInput, toolCallId) {
    const startedAt = new Date().toISOString();
    const audit = () => ({ userId:ctx.userId,accountId:ctx.accountId,startedAt,completedAt:new Date().toISOString() });
    try {
      const { offset,limit } = inputSchema.parse(rawInput ?? {});
      const activity = await createMailService(ctx).activity(
        ctx.accountId, "1970-01-01T00:00:00.000Z", "9999-12-31T23:59:59.999Z", ["Inbox","Sent"]
      );
      const report = buildInboxTriage(activity as Activity);
      return { ok:true,toolCallId,audit:audit(),data:{
        scannedInboxMessages:report.scannedInboxMessages,
        scannedSentMessages:report.scannedSentMessages,
        complete:report.complete,
        incompleteReason:report.incompleteReason,
        missingRequiredMailboxes:activity.missingRequiredMailboxes,
        candidateCount:report.candidateCount,offset,returned:report.candidates.slice(offset,offset+limit).length,
        hasMore:offset+limit<report.candidateCount,
        candidates:report.candidates.slice(offset,offset+limit),
        note:"Candidates require conversation-level verification. Read and unread are both included. Counts are candidates, not confirmed messages requiring replies."
      }};
    } catch(error) {
      return { ok:false,toolCallId,audit:audit(),error:reportChatError(error,{operation:"mail.triage",category:"mail"}) };
    }
  },
};
