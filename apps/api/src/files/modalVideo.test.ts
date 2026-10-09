import test from "node:test";
import assert from "node:assert/strict";
import { config } from "../config.js";
import { videoCollectionUrl, submitModalVideo, pollModalVideo, downloadModalVideo, configuredVideoModels } from "./modalVideo.js";

test("all configured Modal video models resolve to their expected endpoint", () => {
  const vars = ["LTX_BASE_URL", "WAN_BASE_URL", "HUNYUAN_BASE_URL"] as const;
  const old = vars.map((v) => process.env[v]);
  try {
    vars.forEach((v) => { process.env[v] = "https://video.modal.run"; });
    for (const model of ["ltx-2.5", "wan-2.2", "hunyuan-video-1.5"] as const) {
      assert.equal(videoCollectionUrl(model).href, "https://video.modal.run/v1/videos");
    }
  } finally {
    vars.forEach((v,i) => { if(old[i] === undefined) delete process.env[v]; else process.env[v] = old[i]; });
  }
});

test("Modal video jobs submit, poll and verify downloadable MP4", async () => {
  const originalFetch = globalThis.fetch;
  const originalToken = config.ai.modalProxyToken;
  const originalUrl = process.env.LTX_BASE_URL;
  const mp4 = Buffer.concat([Buffer.alloc(4), Buffer.from("ftyp"), Buffer.alloc(60)]);
  try {
    (config.ai as { modalProxyToken?: string }).modalProxyToken = "video-test";
    process.env.LTX_BASE_URL = "https://test.modal.run/v1/videos";
    let attempts = 0;
    globalThis.fetch = async (url, options) => {
      attempts++;
      assert.equal(new Headers(options?.headers).get("Authorization"), "Bearer video-test");
      if (attempts === 1) {
        assert.equal(String(url), "https://test.modal.run/v1/videos");
        assert.equal(new Headers(options?.headers).get("Idempotency-Key"), "task-123");
        const body = JSON.parse(String(options?.body));
        assert.equal(body.model,"Lightricks/LTX-2.5");
        return Response.json({ id: "job_123", status: "queued" });
      }
      if (attempts === 2) {
        assert.equal(String(url), "https://test.modal.run/v1/videos/job_123");
        return Response.json({ id: "job_123", status: "completed" });
      }
      assert.equal(String(url), "https://test.modal.run/v1/videos/job_123/content");
      return new Response(new Uint8Array(mp4), { headers: { "content-type": "video/mp4" } });
    };
    assert.ok(configuredVideoModels().includes("ltx-2.5"));
    assert.deepEqual(await submitModalVideo({model:"ltx-2.5",prompt:"A puppy",idempotencyKey:"task-123"}), {id:"job_123",status:"queued"});
    assert.equal((await pollModalVideo("ltx-2.5","job_123")).status,"completed");
    assert.deepEqual(await downloadModalVideo("ltx-2.5","job_123"),mp4);
  } finally {
    globalThis.fetch = originalFetch;
    (config.ai as { modalProxyToken?: string }).modalProxyToken = originalToken;
    if (originalUrl === undefined) delete process.env.LTX_BASE_URL; else process.env.LTX_BASE_URL = originalUrl;
  }
});

test("rejects unsafe video endpoint schemes", () => {
  const originalUrl = process.env.WAN_BASE_URL;
  try {
    process.env.WAN_BASE_URL = "http://169.254.169.254/latest";
    assert.throws(() => videoCollectionUrl("wan-2.2"), /invalid/i);
  } finally {
    if (originalUrl === undefined) delete process.env.WAN_BASE_URL; else process.env.WAN_BASE_URL = originalUrl;
  }
});
