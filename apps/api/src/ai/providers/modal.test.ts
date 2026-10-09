import test from "node:test";
import assert from "node:assert/strict";
import { config } from "../../config.js";
import { modalProvider } from "./modal.js";
const testConfig = config.ai as { modalProxyToken: string | undefined; gptOssVllmBaseUrl: string | undefined };

test("Modal GPT-OSS normalizes tool calls and model ID", async () => {
  const originalFetch = globalThis.fetch;
  const oldToken = testConfig.modalProxyToken;
  const oldUrl = testConfig.gptOssVllmBaseUrl;
  try {
    testConfig.modalProxyToken = "test-token";
    testConfig.gptOssVllmBaseUrl = "https://test.modal.run";
    globalThis.fetch = async (url, init) => {
      assert.equal(String(url), "https://test.modal.run/v1/chat/completions");
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test-token");
      const body = JSON.parse(String(init?.body));
      assert.equal(body.model, "gpt-oss-120b");
      return Response.json({ choices: [{ finish_reason: "tool_calls", message: { content: null, tool_calls: [{ id: "chatcmpl-tool-1", function: { name: "mail__search", arguments: '{"query":"hello"}' } }] } }] });
    };
    const result = await modalProvider.run({ messages: [{ role: "user", content: "Search inbox" }] });
    assert.equal(result.model, "gpt-oss-120b");
    assert.equal(result.toolCalls[0]?.id, "chatcmpl-tool-1");
    assert.equal(result.toolCalls[0]?.function.name, "mail__search");
  } finally {
    globalThis.fetch = originalFetch;
    testConfig.modalProxyToken = oldToken;
    testConfig.gptOssVllmBaseUrl = oldUrl;
  }
});
test("Modal rejects malformed tool arguments and length truncation", async () => {
  const originalFetch = globalThis.fetch;
  const oldToken = testConfig.modalProxyToken;
  const oldUrl = testConfig.gptOssVllmBaseUrl;
  try {
    testConfig.modalProxyToken = "test-token";
    testConfig.gptOssVllmBaseUrl = "https://test.modal.run";
    globalThis.fetch = async () => Response.json({ choices: [{ finish_reason: "tool_calls", message: { tool_calls: [{ id: "a", function: { name: "mail__send", arguments: "{not-json" } }] } }] });
    await assert.rejects(modalProvider.run({ messages: [] }), /invalid tool call/);
    globalThis.fetch = async () => Response.json({ choices: [{ finish_reason: "length", message: { content: "incomplete" } }] });
    await assert.rejects(modalProvider.run({ messages: [] }), /incomplete/);
  } finally {
    globalThis.fetch = originalFetch;
    testConfig.modalProxyToken = oldToken;
    testConfig.gptOssVllmBaseUrl = oldUrl;
  }
});
