import assert from "node:assert/strict";
import test from "node:test";
import { mcpOutboundIdempotencyKey } from "./outboundIdempotency.js";

test("MCP mail send uses the already reserved action key", () => {
  const reservedKey = "mcp:example-reserved-key";
  assert.equal(mcpOutboundIdempotencyKey("mail.send_draft", reservedKey), reservedKey);
  assert.equal(mcpOutboundIdempotencyKey("mail__send_draft", reservedKey), reservedKey);
});

test("other MCP actions do not inherit the outbound send key", () => {
  assert.equal(mcpOutboundIdempotencyKey("mail.create_draft", "mcp:example"), undefined);
  assert.equal(mcpOutboundIdempotencyKey("mail.search", "mcp:example"), undefined);
});
