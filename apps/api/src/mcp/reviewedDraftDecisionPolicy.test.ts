import assert from "node:assert/strict";
import test from "node:test";
import { mcpArgumentsDigest } from "./writeApprovalPolicy.js";
import { isReviewedDraftDecisionValid } from "./reviewedDraftDecisionPolicy.js";

const args = { to: ["test@example.com"], subject: "Controlled draft" };
const digest = mcpArgumentsDigest(args);
const now = new Date("2026-10-18T15:00:00Z");
const valid = {
  toolName: "mail.create_draft", status: "pending",
  expiresAt: new Date("2026-10-18T15:15:00Z"), arguments: args,
};

test("only a pending unexpired exact draft may be decided", () => {
  assert.equal(isReviewedDraftDecisionValid(valid, digest, now), true);
  assert.equal(isReviewedDraftDecisionValid(null, digest, now), false);
  assert.equal(isReviewedDraftDecisionValid({ ...valid, status: "approved" }, digest, now), false);
  assert.equal(isReviewedDraftDecisionValid({ ...valid, status: "rejected" }, digest, now), false);
  assert.equal(isReviewedDraftDecisionValid({ ...valid, status: "consumed" }, digest, now), false);
  assert.equal(isReviewedDraftDecisionValid({ ...valid, toolName: "mail.send_draft" }, digest, now), false);
  assert.equal(isReviewedDraftDecisionValid({ ...valid, arguments: { ...args, subject: "Edited" } }, digest, now), false);
  assert.equal(isReviewedDraftDecisionValid({ ...valid, expiresAt: now }, digest, now), false);
  assert.equal(isReviewedDraftDecisionValid({ ...valid, expiresAt: new Date(now.getTime()-1) }, digest, now), false);
  assert.equal(isReviewedDraftDecisionValid(valid, "bad digest", now), false);
});
