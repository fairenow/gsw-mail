import test from "node:test";
import assert from "node:assert/strict";
import { buildInboxTriage, advanceScan } from "./inboxTriageTools.js";

const row = (id: string, thread: string, date: string, direction: string, read = true) => ({
  messageId: id, threadId: thread, date, direction, subject: "Sample", from: "customer@example.com",
  to: "owner@example.com", snippet: "Can you help?", read,
});
test("triage includes both read and unread inbound messages and deduplicates threads", () => {
  const report = buildInboxTriage({ complete:true, folders:[
    { role:"inbox",mailbox:"Inbox",complete:true,messages:[
      row("a","one","2026-10-10T00:00:00Z","inbound",false),
      row("b","one","2026-10-11T00:00:00Z","inbound",true),
      row("c","two","2026-10-12T00:00:00Z","inbound",false),
    ]},
    { role:"sent",mailbox:"Sent",complete:true,messages:[row("d","one","2026-10-09T00:00:00Z","outbound")]},
  ]});
  assert.equal(report.complete,true);
  assert.equal(report.scannedInboxMessages,3);
  assert.equal(report.candidateCount,2);
  assert.equal(report.candidates[0]?.status,"potential_reply_needed");
});
test("triage avoids claims of full coverage if a folder is truncated", () => {
  const report = buildInboxTriage({complete:false,folders:[
    {role:"inbox",mailbox:"Inbox",complete:false,messages:[row("a","one","2026-10-10T00:00:00Z","inbound")]},
    {role:"sent",mailbox:"Sent",complete:true,messages:[]},
  ]});
  assert.equal(report.complete,false);
  assert.ok(report.incompleteReason);
});
test("triage considers latest outbound mail as waiting on the other party", () => {
  const report = buildInboxTriage({complete:true,folders:[
    {role:"inbox",mailbox:"Inbox",complete:true,messages:[row("a","one","2026-10-10T00:00:00Z","inbound")]},
    {role:"sent",mailbox:"Sent",complete:true,messages:[row("b","one","2026-10-11T00:00:00Z","outbound")]},
  ]});
  assert.equal(report.candidates[0]?.status,"waiting_or_followup_candidate");
});

test("outbound copy alone is not counted as an unanswered inbound conversation", () => {
  const report = buildInboxTriage({complete:true,folders:[
    {role:"inbox",mailbox:"Inbox",complete:true,messages:[row("copy","a","2026-10-10T00:00:00Z","outbound_copy")]},
    {role:"sent",mailbox:"Sent",complete:true,messages:[]},
  ]});
  assert.equal(report.candidateCount,1);
  assert.equal(report.candidates[0]?.status,"waiting_or_followup_candidate");
  assert.equal(report.candidates[0]?.requiresThreadReview,true);
});
test("missing Sent folder prevents a complete reply-status claim", () => {
  const report = buildInboxTriage({complete:false,folders:[
    {role:"inbox",mailbox:"Inbox",complete:true,messages:[row("in","a","2026-10-10T00:00:00Z","inbound")]},
  ]});
  assert.equal(report.complete,false);
  assert.match(report.incompleteReason ?? "",/unavailable|truncated/);
});

test("incremental scans save progress and transition Inbox to Sent before completion", () => {
  const state = {
    folder:"inbox" as const,offset:0,version:0,updatedAt:"",
    folders:[
      {mailbox:"Inbox",role:"inbox",complete:false,messages:[] as ReturnType<typeof row>[]},
      {mailbox:"Sent",role:"sent",complete:false,messages:[] as ReturnType<typeof row>[]},
    ],
  };
  const next=advanceScan(state,{
    folder:"inbox",offset:0,pageSize:250,exhausted:true,
    messages:[row("one","t","2026-10-10T00:00:00Z","inbound")],
  });
  assert.equal(next.folder,"sent");
  assert.equal(next.version,1);
  assert.equal(next.folders[0]?.complete,true);
  assert.equal(state.folders[0]?.messages.length,0);
  const done=advanceScan(next,{folder:"sent",offset:0,pageSize:250,exhausted:true,messages:[]});
  assert.equal(done.folder,"done");
  assert.equal(done.version,2);
});
test("incremental scan refuses stale pages rather than doubling counts", () => {
  const state = {
    folder:"inbox" as const,offset:250,version:1,updatedAt:"",
    folders:[
      {mailbox:"Inbox",role:"inbox",complete:false,messages:[] as ReturnType<typeof row>[]},
      {mailbox:"Sent",role:"sent",complete:false,messages:[] as ReturnType<typeof row>[]},
    ],
  };
  assert.throws(()=>advanceScan(state,{folder:"inbox",offset:0,pageSize:250,exhausted:false,messages:[]}),/Stale/);
});
