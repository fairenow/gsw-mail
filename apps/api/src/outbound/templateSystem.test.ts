import assert from "node:assert/strict";
import test from "node:test";

import { buildOutgoingMessage } from "../mail/messageBuilder.js";

const signature = {
  enabled: true,
  onNew: true,
  onReply: true,
  onForward: true,
  position: "beforeQuotedText" as const,
  signatureHtml: "<div>Ramon Williams Jr.</div><div>Guided Steps Wellness: The Community</div><div>734-545-3247</div><div><a href=\"https://guidedstepswellness.com\">Visit Us Here!</a></div>",
  signatureText: "Ramon Williams Jr.\nGuided Steps Wellness: The Community\n734-545-3247\nVisit Us Here!",
};

test("template system removes legacy greeting/signature preamble and emits one canonical signature", () => {
  const result = buildOutgoingMessage({
    templateKey: "gsw_default",
    senderEmail: "ramon@team.guidedstepswellness.com",
    mode: "new",
    signature,
    bodyHtml: `<div>Hello,</div>${signature.signatureHtml}<div><br></div><div>Hello Buddy,</div><div>This is the actual message.</div><div><br></div><div class=\"gsw-signature\">${signature.signatureHtml}</div>`,
  });

  assert.equal((result.bodyHtml.match(/data-gsw-signature=\"true\"/g) ?? []).length, 1);
  assert.equal((result.bodyHtml.match(/Ramon Williams Jr\./g) ?? []).length, 1);
  assert.match(result.bodyHtml, /Hello Buddy,/);
  assert.doesNotMatch(result.bodyHtml, /^\s*<div>Hello,?<\/div>/i);
  assert.match(result.html, /gsw-template:gsw_default:2026-09-23-v2/);
  assert.match(result.html, /Facebook/);
  assert.match(result.html, /LinkedIn/);
});

test("Bible template contains the YouTube project link and version marker", () => {
  const result = buildOutgoingMessage({
    templateKey: "bible_reader",
    senderEmail: "ramon@team.guidedstepswellness.com",
    mode: "new",
    signature,
    bodyHtml: "<div>Testing Bible template.</div>",
  });

  assert.match(result.html, /https:\/\/www\.youtube\.com\/@bible_study_app/);
  assert.match(result.html, /youtube-email-icon\.png\?v=2026-09-23-v2/);
  assert.match(result.html, /gsw-template:bible_reader:2026-09-23-v2/);
  assert.equal((result.bodyHtml.match(/data-gsw-signature=\"true\"/g) ?? []).length, 1);
});

test("reply signature is inserted before quoted history", () => {
  const result = buildOutgoingMessage({
    templateKey: "gsw_default",
    senderEmail: "ramon@team.guidedstepswellness.com",
    mode: "reply",
    signature,
    bodyHtml: "<div>Thanks for the note.</div><div>On Sep 23, sender wrote:</div><blockquote>Prior message</blockquote>",
  });

  assert.ok(result.bodyHtml.indexOf("data-gsw-signature") < result.bodyHtml.indexOf("On Sep 23"));
  assert.equal((result.bodyHtml.match(/data-gsw-signature=\"true\"/g) ?? []).length, 1);
});
