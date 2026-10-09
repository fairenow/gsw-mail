import test from "node:test";
import assert from "node:assert/strict";
import { defaultAiCapabilities } from "./capabilities.js";
import { selectAgentTools } from "./toolSelection.js";

for (const prompt of [
  "Please create a video of a puppy running",
  "Can you turn this puppy image into a video of the puppy running?",
  "Animate this drawing",
]) {
  test("video intent exposes the permissioned video tool: " + prompt, () => {
    const result = selectAgentTools({
      userMessage: prompt, capabilitySettings: defaultAiCapabilities,
      hasOpenAi: false, hasImageProvider: true, hasBrowserProvider: false,
    });
    assert.ok(result.selectedToolNames.includes("videos.generate"));
    assert.ok(result.tools.some((tool) => tool.function.name === "videos__generate"));
  });
}

test("disabled image/video capability never exposes video generation", () => {
  const result = selectAgentTools({
    userMessage: "Create a video", capabilitySettings: { ...defaultAiCapabilities, imageGeneration: false },
    hasOpenAi: false, hasImageProvider: false, hasBrowserProvider: false,
  });
  assert.ok(!result.selectedToolNames.includes("videos.generate"));
});
