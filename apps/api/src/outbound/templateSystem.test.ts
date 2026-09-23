import assert from "node:assert/strict";
import test from "node:test";

import { buildOutgoingMessage } from "../mail/messageBuilder.js";

const signatureHtml = '<div class="gsw-signature" data-gsw-signature="true"><div>Ramon Williams Jr.</div><div>Guided Steps Wellness: The Community</div><div>734-545-3247</div><div><a href="https://thecommunity.guidedstepswellness.com" target="_blank" rel="noopener noreferrer">Visit Us Here!</a></div></div>';

test("template renderer preserves the compose-body signature without appending another copy", () => {
  const result = buildOutgoingMessage({
    templateKey: "gsw_default",
    senderEmail: "ramon@team.guidedstepswellness.com",
    bodyHtml: `<div>Hey,</div><div>Check it out!</div><div>Best,</div>${signatureHtml}`,
  });

  // Rich-text sanitization intentionally removes internal data-* markers. The
  // user-visible signature is the invariant: preserve its content exactly once.
  assert.equal((result.bodyHtml.match(/Ramon Williams Jr\./g) ?? []).length, 1);
  assert.equal((result.html.match(/Ramon Williams Jr\./g) ?? []).length, 1);
  assert.match(result.html, /gsw-template:gsw_default:2026-09-23-v2/);
  assert.match(result.html, /Facebook/);
  assert.match(result.html, /LinkedIn/);
});

test("template renderer does not invent a signature when compose has signatures disabled", () => {
  const result = buildOutgoingMessage({
    templateKey: "gsw_default",
    senderEmail: "ramon@team.guidedstepswellness.com",
    bodyHtml: "<div>Hello,</div><div>Thanks for reaching out!</div>",
  });

  assert.doesNotMatch(result.bodyHtml, /Ramon Williams Jr\./);
  assert.doesNotMatch(result.html, /Ramon Williams Jr\./);
  assert.match(result.bodyHtml, /^<div>Hello,<\/div>/);
});

test("production-style signature HTML and URLs pass through without regex processing", () => {
  assert.doesNotThrow(() => buildOutgoingMessage({
    templateKey: "gsw_default",
    senderEmail: "ramon@team.guidedstepswellness.com",
    bodyHtml: `<div>Hey Buddy,</div><div>Ol' pal, check it out.</div><div>Blessings,</div>${signatureHtml}`,
  }));
});

test("Bible template contains the YouTube project link and keeps the body signature once", () => {
  const result = buildOutgoingMessage({
    templateKey: "bible_reader",
    senderEmail: "ramon@team.guidedstepswellness.com",
    bodyHtml: `<div>Testing Bible template.</div>${signatureHtml}`,
  });

  assert.match(result.html, /https:\/\/www\.youtube\.com\/@bible_study_app/);
  assert.match(result.html, /youtube-email-icon\.png\?v=2026-09-23-v2/);
  assert.match(result.html, /gsw-template:bible_reader:2026-09-23-v2/);
  assert.equal((result.html.match(/Ramon Williams Jr\./g) ?? []).length, 1);
});

test("reply body ordering is preserved; template does not relocate its signature", () => {
  const bodyHtml = `<div>Thanks for the note.</div>${signatureHtml}<div>On Sep 23, sender wrote:</div><blockquote>Prior message</blockquote>`;
  const result = buildOutgoingMessage({
    templateKey: "gsw_default",
    senderEmail: "ramon@team.guidedstepswellness.com",
    bodyHtml,
  });

  assert.ok(result.bodyHtml.indexOf("Ramon Williams Jr.") < result.bodyHtml.indexOf("On Sep 23"));
  assert.equal((result.bodyHtml.match(/Ramon Williams Jr\./g) ?? []).length, 1);
});
