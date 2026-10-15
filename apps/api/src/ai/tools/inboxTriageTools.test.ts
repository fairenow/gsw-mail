import test from "node:test";
import assert from "node:assert/strict";
import { buildInboxTriage } from "./inboxTriageTools.js";

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
