import test from "node:test";
import assert from "node:assert/strict";
import { actionDisplayLabel, permissionCopyForScope, confirmationSummaryForAction } from "./actionDisplay.js";

test("video permission uses product language instead of scope identifiers", () => {
  const copy = permissionCopyForScope("videos.generate");
  assert.equal(copy.title, "Allow GSW Chat to generate videos?");
  assert.match(copy.description, /background/);
  assert.doesNotMatch(JSON.stringify(copy), /videos\.generate/);
});

test("unknown scope names display as readable words", () => {
  const copy = permissionCopyForScope("calendar.write");
  assert.match(copy.title, /manage calendar events/);
  assert.doesNotMatch(copy.title, /calendar\.write/);
});

test("all action confirmations avoid developer tool syntax", () => {
  for (const name of ["videos.generate", "files.generate_image", "mail.send_draft", "campaign.launch", "automations.create"]) {
    const summary = confirmationSummaryForAction(name);
    assert.doesNotMatch(summary, /\b(?:videos|files|mail|campaign|automations)\.(?:generate|generate_image|send_draft|launch|create)/);
    assert.ok(summary.endsWith("?"));
  }
  assert.equal(confirmationSummaryForAction("videos.generate"), "Allow GSW Chat to generate a video?");
  assert.equal(confirmationSummaryForAction("video.generate"), "Allow GSW Chat to generate a video?");
  assert.equal(actionDisplayLabel("files__create_artifact"), "create a document");
});
