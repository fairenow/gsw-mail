import { randomUUID } from "node:crypto";
import {
  claimChatExecution, finishChatExecution, heartbeatChatExecution,
  quarantineExpiredChatExecutions, type ChatExecution,
} from "./chatExecutionQueue.js";

export type ChatExecutionHandler = (job: ChatExecution, signal: AbortSignal) => Promise<unknown>;

/**
 * Optional in-process runner for the existing Railway API.
 * Not started until chat request preparation and tool checkpoints are integrated.
 * Expired leases are quarantined, never blindly re-enqueued.
 */
export function createChatExecutionRunner(handler: ChatExecutionHandler, options: {
  pollMs?: number; leaseSeconds?: number; onError?: (error: unknown) => void;
} = {}) {
  const owner = randomUUID();
  const pollMs = options.pollMs ?? 2_000;
  const leaseSeconds = options.leaseSeconds ?? 120;
  let timer: ReturnType<typeof setInterval> | undefined;
  let running = false;
  let stopped = false;
  let activeAbort: AbortController | undefined;

  async function tick() {
    if (running || stopped) return;
    running = true;
    try {
      await quarantineExpiredChatExecutions();
      const job = await claimChatExecution(owner, leaseSeconds);
      if (!job) return;
      let leaseLost = false;
      const abort = new AbortController();
      activeAbort = abort;
      let heartbeatPending = false;
      const heartbeat = setInterval(() => {
        if (heartbeatPending || leaseLost || stopped) return;
        heartbeatPending = true;
        void heartbeatChatExecution(job.id, owner, leaseSeconds)
          .then(ok => {
            if (!ok) { leaseLost = true; abort.abort(); }
          })
          .catch(error => {
            leaseLost = true;
            abort.abort();
            options.onError?.(error);
          })
          .finally(() => { heartbeatPending = false; });
      }, Math.max(1_000, Math.floor(leaseSeconds * 1_000 / 3)));
      try {
        const result = await handler(job, abort.signal);
        if (!leaseLost && !stopped && !abort.signal.aborted) {
          const committed = await finishChatExecution(job.id, owner, "completed", result);
          if (!committed) options.onError?.(new Error("Chat execution lease lost before completion"));
        }
      } catch (error) {
        if (!leaseLost && !stopped && !abort.signal.aborted) {
          await finishChatExecution(job.id, owner, "uncertain", undefined,
            error instanceof Error ? error.message : "Execution failed");
        }
        options.onError?.(error);
      } finally {
        clearInterval(heartbeat);
        activeAbort = undefined;
      }
    } catch (error) {
      options.onError?.(error);
    } finally {
      running = false;
    }
  }

  return {
    start() {
      if (timer) return;
      stopped = false;
      timer = setInterval(() => { void tick(); }, pollMs);
      void tick();
    },
    stop() {
      stopped = true;
      activeAbort?.abort();
      if (timer) clearInterval(timer);
      timer = undefined;
    },
    runOnce: tick,
  };
}
