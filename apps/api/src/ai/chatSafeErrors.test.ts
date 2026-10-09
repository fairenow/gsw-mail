import test from "node:test";
import assert from "node:assert/strict";
import { chatErrorText, reportChatError } from "./chatSafeErrors.js";

test("chat error responses exclude underlying secrets and paths", () => {
  const sensitive = "password=SECRET; postgres://privatehost/db; /app/internal/service.ts";
  const err = reportChatError(new Error(sensitive), { operation: "mail.activity", category: "mail" });
  const exposed = JSON.stringify(err) + chatErrorText(err);
  assert.doesNotMatch(exposed, /SECRET|privatehost|internal\/service/);
  assert.match(err.incidentId, /^GSW-[0-9A-F]{12}$/);
  assert.equal(err.code, "mail_failed");
  assert.equal(err.retryable, false);
});

test("only safe metadata is returned for arbitrary errors", () => {
  const err = reportChatError({ secret: "api-key-value" }, { operation: "files.read", category: "files" });
  assert.equal(err.message, "GSW Mail couldn't process the file. Please try again.");
  assert.doesNotMatch(JSON.stringify(err), /api-key-value/);
});
