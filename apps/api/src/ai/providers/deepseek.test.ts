import test from "node:test";
import assert from "node:assert/strict";
import { config } from "../../config.js";
import { modalDeepseekProvider } from "./modal.js";
import { getAiProvider } from "./index.js";

test("DeepSeek is routed through Modal and returns normalized tool calls", async () => {
  const previous = globalThis.fetch;
  const token = config.ai.modalProxyToken;
  const endpoint = process.env.DEEPSEEK_BASE_URL;
  try {
    (config.ai as { modalProxyToken: string | undefined }).modalProxyToken = "local-test-token";
    process.env.DEEPSEEK_BASE_URL = "https://test.modal.run";
    globalThis.fetch = async (url, init) => {
      assert.equal(String(url), "https://test.modal.run/v1/chat/completions");
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer local-test-token");
      const body = JSON.parse(String(init?.body));
      assert.equal(body.model, "deepseek-ai/DeepSeek-V4.1-Flash");
      assert.equal(body.parallel_tool_calls, false);
      return Response.json({choices:[{finish_reason:"tool_calls",message:{content:null,tool_calls:[{id:"call1",function:{name:"files__list",arguments:"{}"}}]}}]});
    };
    assert.equal(getAiProvider("deepseek-v4.1-flash"), modalDeepseekProvider);
    const output = await modalDeepseekProvider.run({messages:[{role:"user",content:"List files"}],tools:[{type:"function",function:{name:"files__list",description:"List files",parameters:{type:"object"}}}]});
    assert.equal(output.model,"deepseek-ai/DeepSeek-V4.1-Flash");
    assert.equal(output.toolCalls[0]?.function.name, "files__list");
  } finally {
    globalThis.fetch = previous;
    (config.ai as { modalProxyToken: string | undefined }).modalProxyToken = token;
    if(endpoint === undefined) delete process.env.DEEPSEEK_BASE_URL;
    else process.env.DEEPSEEK_BASE_URL = endpoint;
  }
});
