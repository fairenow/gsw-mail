import test from "node:test";
import assert from "node:assert/strict";
import { chatErrorText, reportChatError, safeErrorReason } from "./chatSafeErrors.js";

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

test("chat display text includes the incident reference but never internal error codes", () => {
  const err = reportChatError(new Error("modal backend secret diagnostics"), { operation: "chat.stream" });
  assert.match(chatErrorText(err), /^GSW Chat couldn't complete this request\. Please try again\. Reference: GSW-[0-9A-F]{12}$/);
  assert.doesNotMatch(chatErrorText(err), /chat_failed|modal|diagnostics/i);
});

test("only known credential denial reasons are eligible for diagnostic logging", () => {
  assert.equal(safeErrorReason(new Error("mailbox_session_required")), "mailbox_session_required");
  assert.equal(safeErrorReason(new Error("mail account not found")), "mail account not found");
  assert.equal(safeErrorReason(new Error("upstream 500 from db://user:pw@host")), undefined);
  assert.equal(safeErrorReason({ message: "mailbox_session_required" }), undefined);
});

test("calendar failures surface a stable incident reference without leaking internals", () => {
  const err = reportChatError(new Error("calendar provider secret"), { operation: "calendar.tool", category: "calendar", retryable: true });
  assert.equal(err.code, "calendar_failed");
  assert.equal(err.retryable, true);
  assert.match(err.incidentId, /^GSW-[0-9A-F]{12}$/);
  assert.doesNotMatch(JSON.stringify(err), /provider secret/);
});
