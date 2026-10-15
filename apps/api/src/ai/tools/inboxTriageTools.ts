import type { AgentToolDefinition } from "./types.js";
import { createMailService } from "../../services/mailService.js";
import { reportChatError } from "../chatSafeErrors.js";
import { z } from "zod";
import { pool } from "../../db/client.js";

const inputSchema = z.object({
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(50).default(30),
  refresh: z.boolean().default(false),
});

type MailRow = {
  messageId: string; threadId?: string | null; subject?: string | null;
  date: string | Date; from: unknown; to: unknown; snippet?: string | null;
  read?: boolean; direction: string;
};
type FolderRow = { role?: string | null; mailbox: string; complete: boolean; messages: MailRow[] };
type Activity = { complete: boolean; folders: FolderRow[]; missingRequiredMailboxes?: string[] };

// Durable, user+mailbox scoped snapshots. The database must have migration 0029
// before triage is enabled; failures are surfaced rather than silently reverting
// to an inaccurate or inconsistent cache across API instances.
const SCAN_TTL_MINUTES = 15;
type TriageReport = ReturnType<typeof buildInboxTriage>;
async function getSnapshot(userId: string, accountId: string): Promise<TriageReport | undefined> {
  const result = await pool.query<{ report: TriageReport }>(
    `SELECT report FROM ai_inbox_triage_snapshots
     WHERE user_id=$1 AND account_id=$2 AND expires_at>now()`,
    [userId,accountId],
  );
  return result.rows[0]?.report;
}
async function setSnapshot(userId:string, accountId:string, report:TriageReport) {
  await pool.query(
    `INSERT INTO ai_inbox_triage_snapshots (user_id,account_id,report,expires_at)
     VALUES ($1,$2,$3::jsonb,now()+interval '15 minutes')
     ON CONFLICT (user_id,account_id) DO UPDATE
     SET report=EXCLUDED.report, expires_at=EXCLUDED.expires_at, updated_at=now()`,
    [userId,accountId,JSON.stringify(report)],
  );
}

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
    incompleteReason: activity.complete && inbox.length > 0 && sent.length > 0 ? undefined : "A required folder was unavailable or the scan was truncated.",
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
      refresh: { type: "boolean", description: "Force a new mailbox scan instead of using a short-lived snapshot." },
    },
    additionalProperties: false,
  },
  requiredScopes: ["mail.read"],
  risk: "read",
  async execute(ctx, rawInput, toolCallId) {
    const startedAt = new Date().toISOString();
    const audit = () => ({ userId:ctx.userId,accountId:ctx.accountId,startedAt,completedAt:new Date().toISOString() });
    try {
      const { offset,limit,refresh } = inputSchema.parse(rawInput ?? {});
      let report = !refresh ? await getSnapshot(ctx.userId,ctx.accountId) : undefined;
      const reusedSnapshot = Boolean(report);
      if (!report) {
        const activity = await createMailService(ctx).activity(
          ctx.accountId, "1970-01-01T00:00:00.000Z", "9999-12-31T23:59:59.999Z", ["Inbox","Sent"]
        );
        report = buildInboxTriage(activity as Activity);
        await setSnapshot(ctx.userId,ctx.accountId,report);
      }
      return { ok:true,toolCallId,audit:audit(),data:{
        scannedInboxMessages:report.scannedInboxMessages,
        scannedSentMessages:report.scannedSentMessages,
        complete:report.complete,
        incompleteReason:report.incompleteReason,
        snapshotReused:reusedSnapshot, snapshotLifetimeSeconds:SCAN_TTL_MINUTES*60,
        candidateCount:report.candidateCount,offset,returned:report.candidates.slice(offset,offset+limit).length,
        hasMore:offset+limit<report.candidateCount,
        nextOffset:offset+limit<report.candidateCount ? offset+limit : null,
        candidates:report.candidates.slice(offset,offset+limit),
        note:"Candidates require conversation-level verification. Read and unread are both included. Counts are candidates, not confirmed messages requiring replies."
      }};
    } catch(error) {
      return { ok:false,toolCallId,audit:audit(),error:reportChatError(error,{operation:"mail.triage",category:"mail"}) };
    }
  },
};

const reviewInput = z.object({
  threadIds: z.array(z.string().trim().min(1).max(1000)).min(1).max(5),
});

// The coordinator uses this bounded, multi-thread read to reason about actual
// reply obligations, instead of equating last inbound or unread with "needs reply".
export const mailTriageReviewTool: AgentToolDefinition = {
  name: "mail.triage_review",
  description: "Review up to five candidate inbox threads together, including recent actual message bodies. Decide which require a reply versus no reply, follow-up, waiting, or other action. This returns evidence, not a definitive AI classification; do not infer that a question is unanswered solely because the latest message is inbound.",
  inputSchema: {
    type: "object",
    properties: {
      threadIds: { type: "array", items: { type: "string" }, minItems:1, maxItems:5,
        description:"Exact thread IDs from mail.triage; never guessed IDs." },
    },
    required:["threadIds"], additionalProperties:false,
  },
  requiredScopes:["mail.read"],
  risk:"read",
  async execute(ctx, rawInput, toolCallId) {
    const startedAt = new Date().toISOString();
    const audit = () => ({userId:ctx.userId,accountId:ctx.accountId,startedAt,completedAt:new Date().toISOString()});
    try {
      const {threadIds} = reviewInput.parse(rawInput ?? {});
      const service = createMailService(ctx);
      const threads = [];
      for (const threadId of [...new Set(threadIds)]) {
        try {
          const summaries = await service.readThread(ctx.accountId,threadId);
          const recent = summaries.slice(-8);
          const messages = await Promise.all(recent.map(async m => {
            const message = await service.readMessage(ctx.accountId,m.engineId,false);
            return {
              messageId:message.engineId, date:message.date,
              from:message.from,to:message.to,subject:message.subject,
              excerpt:(message.textBody || message.htmlBody || "").slice(0,2400),
              bodyTruncated:(message.textBody || message.htmlBody || "").length > 2400,
            };
          }));
          threads.push({threadId,complete:summaries.length<=8,totalMessages:summaries.length,messages});
        } catch {
          // Per-thread read errors must not erase successfully reviewed threads.
          threads.push({threadId,complete:false,totalMessages:0,messages:[],unavailable:true});
        }
      }
      return {ok:true,toolCallId,audit:audit(),data:{
        threads,requested:threadIds.length,
        reviewed:threads.filter(t=>!('unavailable' in t)).length,
        instructions:"Classify each thread using the content and sequence, and flag uncertain or truncated threads for additional reading. Do not report any thread as fully verified if it is unavailable or truncated.",
      }};
    } catch (error) {
      return {ok:false,toolCallId,audit:audit(),error:reportChatError(error,{operation:"mail.triage_review",category:"mail"})};
    }
  },
};
