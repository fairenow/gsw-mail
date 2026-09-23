import { strict as assert } from "node:assert";
import { test } from "node:test";
import { sanitizeOutboundHeaderValue } from "./relay.js";

test("sanitizeOutboundHeaderValue unfolds RFC header continuations", () => {
  assert.equal(
    sanitizeOutboundHeaderValue("<first@example.com>\r\n\t<second@example.com>"),
    "<first@example.com> <second@example.com>",
  );
});

test("sanitizeOutboundHeaderValue removes raw CR LF and null characters", () => {
  assert.equal(
    sanitizeOutboundHeaderValue("<reply@example.com>\r\nInjected: bad\0value"),
    "<reply@example.com> Injected: bad value",
  );
});

test("sanitizeOutboundHeaderValue preserves valid message id syntax", () => {
  assert.equal(sanitizeOutboundHeaderValue("<abc.123@team.guidedstepswellness.com>"), "<abc.123@team.guidedstepswellness.com>");
});
