import test from "node:test";
import assert from "node:assert/strict";
import { assembleTriageReport } from "./triageReportTools.js";
const scan={complete:true,scannedInboxMessages:2859,scannedSentMessages:100,candidates:[
  {threadId:"a",latestDate:"2026-10-10T00:00:00Z",subject:"Quote"},
  {threadId:"b",latestDate:"2026-10-11T00:00:00Z",subject:"FYI"},
]};
const verdict={category:"needs_reply",priority:"high",summary:"The sender requests a price estimate.",
  reason:"A direct request is present.",evidenceMessageIds:["m1"],confidence:"medium"};
test("triage report distinguishes scanned messages, reviewed conversations and unreviewed candidates",()=>{
  const report=assembleTriageReport(scan,[{threadId:"a",complete:true,verdict}]);
  assert.equal(report.scannedInboxMessages,2859);
  assert.equal(report.candidateCount,2);
  assert.equal(report.reviewedCount,1);
  assert.equal(report.unreviewedCount,1);
  assert.equal(report.confirmedCategoriesExhaustive,false);
  assert.equal(report.categoryCounts.needs_reply,1);
});
test("triage report rejects irrelevant and malformed verdicts",()=>{
  const report=assembleTriageReport(scan,[
    {threadId:"not-in-scan",complete:true,verdict},
    {threadId:"b",complete:true,verdict:{...verdict,category:"invented"}},
  ]);
  assert.equal(report.reviewedCount,0);
  assert.equal(report.unreviewedCount,2);
});
test("triage report supports exhaustive but uncertain reviews without hiding uncertainty",()=>{
  const report=assembleTriageReport(scan,[
    {threadId:"a",complete:true,verdict},
    {threadId:"b",complete:false,verdict:{...verdict,category:"uncertain",confidence:"low"}},
  ]);
  assert.equal(report.confirmedCategoriesExhaustive,true);
  assert.equal(report.categoryCounts.uncertain,1);
});
