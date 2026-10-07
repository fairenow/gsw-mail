import assert from "node:assert/strict";
import test from "node:test";

import { applySignature } from "./mailService.js";

const signature = {
  signatureText: "Ramon Williams Jr.\nGuided Steps Wellness: The Community\n734-545-3247\nVisit Us Here!",
  signatureHtml: '<div>Ramon Williams Jr.</div><div>Guided Steps Wellness: The Community</div><div><a href="tel:7345453247">734-545-3247</a></div><div><a href="https://thecommunity.guidedstepswellness.com">Visit Us Here!</a></div>',
} as Parameters<typeof applySignature>[0]["signature"];

test("AI draft text that already ends with the configured signature is not signed twice", () => {
  const result = applySignature({
    textBody: "Hi there,\n\nThanks for the update.\n\nBest regards,\n\nRamon Williams Jr.\nGuided Steps Wellness: The Community\n734-545-3247\nVisit Us Here!",
    richText: true,
    signature,
  });

  assert.equal((result.textBody?.match(/Ramon Williams Jr\./g) ?? []).length, 1);
  assert.equal((result.htmlBody?.match(/Ramon Williams Jr\./g) ?? []).length, 1);
  assert.match(result.htmlBody ?? "", /Best regards/);
});

test("HTML that already contains the configured signature is not signed twice", () => {
  const result = applySignature({
    htmlBody: '<div>Hello!</div><div>Best regards,</div><div>Ramon Williams Jr.</div><div>Guided Steps Wellness: The Community</div><div>734-545-3247</div><div>Visit Us Here!</div>',
    textBody: "Hello!\n\nBest regards,\n\nRamon Williams Jr.\nGuided Steps Wellness: The Community\n734-545-3247\nVisit Us Here!",
    richText: true,
    signature,
  });

  assert.equal((result.htmlBody?.match(/Ramon Williams Jr\./g) ?? []).length, 1);
  assert.equal((result.textBody?.match(/Ramon Williams Jr\./g) ?? []).length, 1);
});

test("signature is appended once when the draft body does not already contain it", () => {
  const result = applySignature({
    textBody: "Hello!\n\nBest regards,",
    richText: true,
    signature,
  });

  assert.equal((result.textBody?.match(/Ramon Williams Jr\./g) ?? []).length, 1);
  assert.equal((result.htmlBody?.match(/Ramon Williams Jr\./g) ?? []).length, 1);
});
