import { appendAiMessage } from "./agentState.js";
import { getAiCapabilitySettings } from "./capabilities.js";
import { getAiProvider } from "./providers/index.js";
import {
  claimRunnableAgentTask,
  claimRunnableTaskStep,
  completeClaimedTaskStep,
  failClaimedTaskStep,
  getAgentTask,
  recomputeAgentTask,
  setAgentTaskWaiting,
  updateAgentTaskStep,
} from "./taskService.js";
import { runReadOnlyWorker } from "./workerService.js";
import type { AgentWorkerId } from "./skills.js";

export interface AgentTaskRunner {
  start(): void;
  stop(): void;
  runOnce(): Promise<number>;
}

const backgroundSafeTools = [
  "search.workspace",
  "files.list",
  "files.search",
  "files.read",
  "files.analyze",
  "contacts.tags",
  "campaign.list",
  "campaign.read",
  "templates.list",
  "integrations.list",
  "browser.search",
  "browser.open",
  "browser.read",
  "browser.screenshot",
];

const workers = new Set<AgentWorkerId>([
  "coordinator",
  "mail",
  "research",
  "calendar",
  "files",
  "campaign",
  "browser",
  "admin",
]);

const normalizeWorker = (value: string): AgentWorkerId =>
  workers.has(value as AgentWorkerId) ? value as AgentWorkerId : "coordinator";

const stepInstruction = (task: Awaited<ReturnType<typeof claimRunnableAgentTask>>, step: NonNullable<Awaited<ReturnType<typeof claimRunnableTaskStep>>>) => {
  if (!task) return step.title;
  const input = Object.keys(step.input ?? {}).length ? JSON.stringify(step.input) : "";
  return [
    "Execute one checkpointed step of a durable GSW background task.",
    `Overall task: ${task.instruction}`,
    `Current step: ${step.title}`,
    ...(input ? [`Step input: ${input}`] : []),
    "",
    "Background execution boundary:",
    "- Use only the tools currently available to this worker.",
    "- Do not send email, mutate drafts, launch campaigns, change settings, submit forms, or perform external writes.",
    "- Do not assume live mailbox/JMAP access is available in the background.",
    "- If this step cannot be completed safely without user input, live mailbox access, a confirmation, or a write capability, begin the response with exactly WAITING_FOR_USER: and explain what is needed.",
    "- Otherwise complete as much useful work as possible and return concise findings plus the recommended next step.",
  ].join("\n");
};

async function runProviderOnlyStep(userId: string, instruction: string) {
  const settings = await getAiCapabilitySettings(userId);
  if (!settings.enabled) throw new Error("GSW AI is disabled for this user");
  const provider = getAiProvider(settings.modelProvider);
  const result = await provider.run({
    messages: [{
      role: "user",
      content: [
        "You are a bounded background worker inside GSW Mail.",
        "You cannot use tools in this run.",
        "Do not claim actions you did not perform.",
        "If the task requires user input, live mailbox access, confirmation, or a write action, begin with exactly WAITING_FOR_USER:.",
        instruction,
      ].join("\n\n"),
    }],
  });
  return {
    worker: "coordinator" as const,
    content: result.content?.trim() || "No additional findings.",
    model: result.model,
    activity: [] as Array<{ tool: string; ok: boolean }>,
  };
}

export function createAgentTaskRunner(intervalMs = 15_000): AgentTaskRunner {
  let timer: NodeJS.Timeout | undefined;
  let running = false;

  const runOnce = async () => {
    if (running) return 0;
    running = true;
    let processed = 0;

    try {
      for (let index = 0; index < 4; index += 1) {
        const task = await claimRunnableAgentTask();
        if (!task) break;

        const step = await claimRunnableTaskStep(task.id);
        if (!step) {
          await recomputeAgentTask(task.id);
          continue;
        }

        processed += 1;
        try {
          const instruction = stepInstruction(task, step);
          const worker = normalizeWorker(step.worker);
          const result = task.accountId
            ? await runReadOnlyWorker({
                worker,
                instruction,
                context: {
                  userId: task.userId,
                  authUserId: task.userId,
                  accountId: task.accountId,
                  headers: {},
                  ...(task.conversationId ? { conversationId: task.conversationId } : {}),
                },
                maxTurns: 4,
                allowedToolNames: backgroundSafeTools,
              })
            : await runProviderOnlyStep(task.userId, instruction);

          const waiting = result.content.trimStart().startsWith("WAITING_FOR_USER:");
          if (waiting) {
            await updateAgentTaskStep(task.userId, task.id, step.sequence, {
              status: "waiting",
              result: {
                content: result.content,
                model: result.model,
                activity: result.activity,
              },
            });
            await setAgentTaskWaiting(task.id, result.content, {
              waitingStepSequence: step.sequence,
              waitingReason: result.content.slice(0, 2_000),
            });
            if (task.conversationId) {
              await appendAiMessage({
                conversationId: task.conversationId,
                role: "assistant",
                content: result.content,
                provider: "task-runner",
                model: result.model,
                metadata: { kind: "task_waiting", taskId: task.id, stepSequence: step.sequence },
              });
            }
            continue;
          }

          await completeClaimedTaskStep(task.id, step.id, {
            content: result.content,
            model: result.model,
            worker: result.worker,
            activity: result.activity,
          });

          const current = await getAgentTask(task.userId, task.id);
          if (current.task.status === "completed" && task.conversationId) {
            const summaries = current.steps
              .filter((item) => item.result && typeof item.result === "object")
              .map((item) => {
                const content = (item.result as Record<string, unknown>).content;
                return typeof content === "string" ? `${item.title}: ${content}` : item.title;
              });
            await appendAiMessage({
              conversationId: task.conversationId,
              role: "assistant",
              content: [
                `Background task complete: ${task.title}`,
                ...(summaries.length ? ["", ...summaries] : []),
              ].join("\n"),
              provider: "task-runner",
              model: result.model,
              metadata: { kind: "task_completed", taskId: task.id },
            });
          }
        } catch (error) {
          const retry = await failClaimedTaskStep(task.id, step.id, error);
          console.warn("[ai:task-runner] step failed", {
            taskId: task.id,
            stepId: step.id,
            retrying: retry.retrying,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    } finally {
      running = false;
    }

    return processed;
  };

  return {
    start() {
      if (timer) return;
      timer = setInterval(() => { void runOnce(); }, intervalMs);
      void runOnce();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = undefined;
    },
    runOnce,
  };
}

let runner: AgentTaskRunner | undefined;

export function getAgentTaskRunner() {
  runner ??= createAgentTaskRunner();
  return runner;
}
