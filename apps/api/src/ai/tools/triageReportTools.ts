import { z } from "zod";
import { pool } from "../../db/client.js";
import { reportChatError } from "../chatSafeErrors.js";
import type { AgentToolDefinition } from "./types.js";
import { triageVerdictSchema } from "./triageClassifyTools.js";

const input=z.object({offset:z.number().int().min(0).default(0),limit:z.number().int().min(1).max(50).default(20)});
const categories=["needs_reply","follow_up","waiting","action_required","no_reply_needed","uncertain"] as const;
const priorities=["high","normal","low"] as const;
type Candidate={threadId:string;latestDate:string;subject?:string|null;from?:unknown};
type ScanReport={complete:boolean;scannedInboxMessages:number;scannedSentMessages:number;candidates:Candidate[]};
export function assembleTriageReport(scan:ScanReport,rawResults:unknown[]) {
  const candidateIds=new Set(scan.candidates.map(c=>c.threadId));
  const verdicts=new Map<string,{threadId:string;complete:boolean;verdict:z.infer<typeof triageVerdictSchema>}>();
  for(const entry of rawResults){
    const result=z.object({threadId:z.string(),complete:z.boolean(),verdict:triageVerdictSchema}).safeParse(entry);
    if(result.success && candidateIds.has(result.data.threadId))verdicts.set(result.data.threadId,result.data);
  }
  const items=scan.candidates.flatMap(candidate=>{
    const result=verdicts.get(candidate.threadId);
    return result?[{...candidate,complete:result.complete,...result.verdict}]:[];
  });
  const counts=Object.fromEntries(categories.map(k=>[k,items.filter(i=>i.category===k).length]));
  const priorityCounts=Object.fromEntries(priorities.map(k=>[k,items.filter(i=>i.priority===k).length]));
  const priorityRank={high:0,normal:1,low:2};
  items.sort((a,b)=>priorityRank[a.priority]-priorityRank[b.priority] || b.latestDate.localeCompare(a.latestDate));
  return {
    scanComplete:scan.complete,scannedInboxMessages:scan.scannedInboxMessages,
    scannedSentMessages:scan.scannedSentMessages,candidateCount:scan.candidates.length,
    reviewedCount:items.length,unreviewedCount:scan.candidates.length-items.length,
    confirmedCategoriesExhaustive:scan.complete && items.length===scan.candidates.length,
    categoryCounts:counts,priorityCounts,items,
  };
}
export const mailTriageReportTool:AgentToolDefinition={
  name:"mail.triage_report",
  description:"Read the current mailbox triage report, with actual scanned/reviewed/unreviewed totals, classification category and priority counts, and concise evidence-backed summaries. Partial reviews are never presented as exhaustive.",
  inputSchema:{type:"object",properties:{offset:{type:"integer",minimum:0},limit:{type:"integer",minimum:1,maximum:50}},additionalProperties:false},
  requiredScopes:["mail.read"],risk:"read",
  async execute(ctx,rawInput,toolCallId){
    const startedAt=new Date().toISOString();
    const audit=()=>({userId:ctx.userId,accountId:ctx.accountId,startedAt,completedAt:new Date().toISOString()});
    try{
      const {offset,limit}=input.parse(rawInput??{});
      const snapshot=await pool.query<{report:ScanReport;expires_at:Date}>(
        "SELECT report,expires_at FROM ai_inbox_triage_snapshots WHERE user_id=$1 AND account_id=$2 AND expires_at>now()",
        [ctx.userId,ctx.accountId]);
      const scan=snapshot.rows[0];
      if(!scan || !scan.report.complete){
        return {ok:true,toolCallId,audit:audit(),data:{scanComplete:false,reportAvailable:false,
          note:"A complete current scan is required. Use mail.triage_scan_step before reporting."}};
      }
      const rows=await pool.query<{verdict:unknown}>(
        "SELECT verdict FROM ai_inbox_triage_verdicts WHERE user_id=$1 AND account_id=$2 AND scan_expires_at=$3",
        [ctx.userId,ctx.accountId,scan.expires_at]);
      const report=assembleTriageReport(scan.report,rows.rows.map(r=>r.verdict));
      return {ok:true,toolCallId,audit:audit(),data:{
        ...report,reviewedCountOnPage:report.items.slice(offset,offset+limit).length,
        offset,nextOffset:offset+limit<report.items.length?offset+limit:null,
        items:report.items.slice(offset,offset+limit),
        note:report.confirmedCategoriesExhaustive
          ?"Every candidate has a recorded classification; uncertainty remains explicitly counted."
          :"Only reviewed candidates are categorized. Unreviewed candidates may still require replies or other action.",
      }};
    }catch(error){
      return {ok:false,toolCallId,audit:audit(),error:reportChatError(error,{operation:"mail.triage_report",category:"mail"})};
    }
  },
};
