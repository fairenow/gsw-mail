import assert from "node:assert/strict";
import test from "node:test";
import { config } from "../../config.js";
import { kimiProvider } from "./kimi.js";
import { getAiProvider } from "./index.js";
const settings = config.ai as { kimiApiKey: string | undefined };

test("Kimi uses the configured key and retains reasoning only for the tool continuation", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = settings.kimiApiKey;
  settings.kimiApiKey = "test-kimi-secret";
  let round = 0;
  try {
    globalThis.fetch = async (url, init) => {
      assert.equal(String(url), `${config.ai.kimiBaseUrl}/chat/completions`);
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test-kimi-secret");
      const body = JSON.parse(String(init?.body));
      assert.equal(body.model, config.ai.kimiModel);
      assert.equal(body.reasoning_effort, "low");
      assert.equal(body.temperature, undefined);
      if (round++ === 0) return Response.json({ choices: [{ finish_reason: "tool_calls", message: { content: null, reasoning_content: "provider-private-metadata", tool_calls: [{ id: "call1", type: "function", function: { name: "mail__search", arguments: '{"query":"hello"}' } }] } }] });
      assert.equal(body.messages.at(-2).reasoning_content, "provider-private-metadata");
      return Response.json({ choices: [{ finish_reason: "stop", message: { content: "Found the message." } }] });
    };
    assert.equal(getAiProvider("kimi"), kimiProvider);
    const first = await kimiProvider.run({ messages: [{ role: "user", content: "Find hello" }] });
    const second = await kimiProvider.run({ messages: [{ role: "assistant", content: first.content, tool_calls: first.toolCalls, reasoning_content: first.reasoningContent! }, { role: "tool", content: "found", tool_call_id: "call1" }] });
    assert.equal(second.content, "Found the message.");
    assert.equal(second.reasoningContent, undefined);
  } finally { globalThis.fetch = originalFetch; settings.kimiApiKey = originalKey; }
});

test("Kimi fails safely for missing credentials, provider errors, malformed calls and truncated output", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = settings.kimiApiKey;
  try {
    settings.kimiApiKey = undefined;
    await assert.rejects(kimiProvider.run({ messages: [] }), /KIMI_API_KEY/);
    settings.kimiApiKey = "test-kimi-secret";
    globalThis.fetch = async () => Response.json({ error: { message: "test-kimi-secret" } }, { status: 401 });
    await assert.rejects(kimiProvider.run({ messages: [] }), error => error instanceof Error && !error.message.includes("test-kimi-secret"));
    globalThis.fetch = async () => Response.json({ choices: [{ message: { tool_calls: [{ id: "c", function: { name: "mail__send", arguments: "not-json" } }] } }] });
    await assert.rejects(kimiProvider.run({ messages: [] }), /invalid response or tool call/);
    globalThis.fetch = async () => Response.json({ choices: [{ finish_reason: "length", message: { content: "partial" } }] });
    await assert.rejects(kimiProvider.run({ messages: [] }), /incomplete response/);
    globalThis.fetch = async () => { throw new DOMException("timeout", "TimeoutError"); };
    await assert.rejects(kimiProvider.run({ messages: [] }), /timed out/);
  } finally { globalThis.fetch = originalFetch; settings.kimiApiKey = originalKey; }
});
