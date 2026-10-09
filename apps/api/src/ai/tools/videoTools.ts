import { z } from "zod";
import { createAgentTask } from "../taskService.js";
import { configuredVideoModels } from "../../files/modalVideo.js";
import type { AgentToolDefinition, AgentToolResult, AgentExecutionContext } from "./types.js";

const videoInput = z.object({
  prompt: z.string().trim().min(1).max(4_000),
  model: z.enum(["ltx-2.5", "wan-2.2", "hunyuan-video-1.5"]).default("ltx-2.5"),
});

export const videoGenerateTool: AgentToolDefinition = {
  name: "videos.generate",
  description: "Queue a video-generation job through Modal. The job continues asynchronously in GSW Tasks, and the completed MP4 is saved in GSW Files. This tool returns a task ID, not a finished video. Use tasks.get to check progress.",
  inputSchema: {
    type: "object",
    properties: {
      prompt: { type: "string", description: "Detailed text-to-video prompt (4,000 characters maximum)." },
      model: { type: "string", enum: ["ltx-2.5", "wan-2.2", "hunyuan-video-1.5"] },
    },
    required: ["prompt"],
    additionalProperties: false,
  },
  requiredScopes: ["files.write", "videos.generate"],
  risk: "reversible_write",
  async execute(ctx: AgentExecutionContext, rawInput: unknown, toolCallId: string): Promise<AgentToolResult> {
    const startedAt = new Date().toISOString();
    try {
      const input = videoInput.parse(rawInput);
      if (!configuredVideoModels().includes(input.model)) {
        return {
          ok: false, toolCallId,
          error: { code: "video_model_unavailable", message: "The selected video model is not available.", retryable: false },
          audit: { userId: ctx.userId, accountId: ctx.accountId, startedAt, completedAt: new Date().toISOString() },
        };
      }
      const task = await createAgentTask({
        userId: ctx.userId,
        ...(ctx.accountId ? { accountId: ctx.accountId } : {}),
        ...(ctx.conversationId ? { conversationId: ctx.conversationId } : {}),
        title: "Generate video with " + input.model,
        instruction: "Generate and save the requested video in GSW Files.",
        metadata: { kind: "modal_video", model: input.model },
        steps: [{ title: "Generate and verify video", input: { kind: "modal_video", ...input } }],
      });
      return {
        ok: true, toolCallId,
        data: { taskId: task.id, status: "queued", model: input.model, message: "Video generation is queued. Check GSW Tasks for progress; the completed MP4 will be saved to GSW Files." },
        audit: { userId: ctx.userId, accountId: ctx.accountId, startedAt, completedAt: new Date().toISOString() },
      };
    } catch {
      return {
        ok: false, toolCallId,
        error: { code: "video_queue_failed", message: "The video request could not be queued.", retryable: false },
        audit: { userId: ctx.userId, accountId: ctx.accountId, startedAt, completedAt: new Date().toISOString() },
      };
    }
  },
};
export const videoTools: AgentToolDefinition[] = [videoGenerateTool];
