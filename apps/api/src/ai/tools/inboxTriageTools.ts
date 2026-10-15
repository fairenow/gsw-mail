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
  date: string | Date; from: unknown; to: unknown; snippet?: string | null | undefined;
  read?: boolean | undefined; direction: string;
};
type FolderRow = { role?: string | null; mailbox: string; complete: boolean; messages: MailRow[] };
type Activity = { complete: boolean; folders: FolderRow[]; missingRequiredMailboxes?: string[] };

// Durable, user+mailbox scoped snapshots. The database must have migration 0031
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
        const state = await loadProgress(ctx.userId,ctx.accountId);
        if (!state || state.folder !== "done") {
          return {ok:true,toolCallId,audit:audit(),data:{
            status:"scanning",complete:false,
            scannedInboxMessages:state?.folders[0]?.messages.length ?? 0,
            scannedSentMessages:state?.folders[1]?.messages.length ?? 0,
            nextFolder:state?.folder ?? "inbox",nextOffset:state?.offset ?? 0,
            instructions:"Use mail.triage_scan_step to advance or resume the scan. Do not present candidate totals yet.",
          }};
        }
        report = buildInboxTriage({complete:true,folders:state.folders});
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

type ScanState = {
  folder: "inbox" | "sent" | "done"; offset: number; version: number;
  folders: FolderRow[]; updatedAt: string;
};
const freshState = (): ScanState => ({
  folder:"inbox",offset:0,version:0,
  folders:[{mailbox:"Inbox",role:"inbox",complete:false,messages:[]},
           {mailbox:"Sent",role:"sent",complete:false,messages:[]}],
  updatedAt:new Date().toISOString(),
});
export function advanceScan(state:ScanState, page:{
  folder:"inbox"|"sent";offset:number;pageSize:number;exhausted:boolean;messages:MailRow[];
}):ScanState {
  if (state.folder!==page.folder || state.offset!==page.offset) throw new Error("Stale triage scan page");
  const next: ScanState=JSON.parse(JSON.stringify(state)) as ScanState;
  const target=next.folders.find(f=>f.role===page.folder)!;
  target.messages.push(...page.messages);
  if(target.messages.length>100_000) throw new Error("Triage scan exceeded safety limit");
  if(page.exhausted) {
    target.complete=true;
    next.folder=page.folder==="inbox" ? "sent" : "done";
    next.offset=0;
  } else next.offset+=page.messages.length;
  next.version++;
  next.updatedAt=new Date().toISOString();
  return next;
}
async function loadProgress(userId:string,accountId:string):Promise<ScanState|undefined> {
  const r=await pool.query<{state:ScanState}>(
    "SELECT state FROM ai_inbox_triage_progress WHERE user_id=$1 AND account_id=$2",[userId,accountId]
  );
  return r.rows[0]?.state;
}
async function saveProgress(userId:string,accountId:string,before:ScanState,after:ScanState) {
  const result=await pool.query(
    `UPDATE ai_inbox_triage_progress SET state=$3::jsonb,updated_at=now()
      WHERE user_id=$1 AND account_id=$2 AND (state->>'version')::int=$4`,
    [userId,accountId,JSON.stringify(after),before.version]
  );
  if(!result.rowCount) throw new Error("Scan was advanced by another request; retry for current progress");
}
export const mailTriageScanStepTool:AgentToolDefinition={
  name:"mail.triage_scan_step",
  description:"Advance a durable whole-inbox scan in bounded pages. Reinvoke while status is scanning. Progress survives server restarts. Call mail.triage for candidate results once finished. Does not classify reply needs.",
  inputSchema:{type:"object",properties:{refresh:{type:"boolean",description:"Reset the scan and begin again (only if explicitly requested)."}},additionalProperties:false},
  requiredScopes:["mail.read"],risk:"read",
  async execute(ctx,rawInput,toolCallId) {
    const startedAt=new Date().toISOString();
    const audit=()=>({userId:ctx.userId,accountId:ctx.accountId,startedAt,completedAt:new Date().toISOString()});
    try {
      const {refresh}=z.object({refresh:z.boolean().default(false)}).parse(rawInput??{});
      // No secrets are persisted; only message summary metadata.
      await pool.query(`INSERT INTO ai_inbox_triage_progress(user_id,account_id,state)
        VALUES($1,$2,$3::jsonb) ON CONFLICT (user_id,account_id) DO NOTHING`,
        [ctx.userId,ctx.accountId,JSON.stringify(freshState())]);
      if(refresh) {
        await pool.query("UPDATE ai_inbox_triage_progress SET state=$3::jsonb,updated_at=now() WHERE user_id=$1 AND account_id=$2",
          [ctx.userId,ctx.accountId,JSON.stringify(freshState())]);
      }
      let state=(await loadProgress(ctx.userId,ctx.accountId))!;
      const service=createMailService(ctx);
      for(let index=0;index<4 && state.folder!=="done";index++){
        const page=await service.triagePage(ctx.accountId,state.folder,state.offset,250);
        const next=advanceScan(state,page);
        await saveProgress(ctx.userId,ctx.accountId,state,next);
        state=next;
      }
      if(state.folder==="done"){
        const report=buildInboxTriage({complete:true,folders:state.folders});
        await setSnapshot(ctx.userId,ctx.accountId,report);
      }
      return {ok:true,toolCallId,audit:audit(),data:{
        status:state.folder==="done"?"completed":"scanning",folder:state.folder,
        nextOffset:state.offset,version:state.version,
        inboxScanned:state.folders[0]?.messages.length??0,
        sentScanned:state.folders[1]?.messages.length??0,
        complete:state.folder==="done",
        instructions:state.folder==="done"
          ?"The scan has finished. Use mail.triage to retrieve candidate pages for review."
          :"Call mail.triage_scan_step again to continue from the saved checkpoint; never claim complete coverage yet.",
      }};
    }catch(error){
      return {ok:false,toolCallId,audit:audit(),error:reportChatError(error,{operation:"mail.triage_scan_step",category:"mail"})};
    }
  },
};
