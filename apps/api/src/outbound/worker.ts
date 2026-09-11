import { config } from "../config.js";
import { getRelay } from "./relay.js";
import { claimDueJobs, loadJob, markDeferred, markFailed, markSent } from "./queue.js";

export interface OutboundWorker {
  start(): void;
  stop(): void;
  runOnce(): Promise<number>;
}

export function createOutboundWorker(intervalMs = 5_000): OutboundWorker {
  const relay = getRelay();
  let timer: NodeJS.Timeout | undefined;
  let running = false;

  const runOnce = async (): Promise<number> => {
    if (running) return 0;
    running = true;
    let processed = 0;
    try {
      const batchSize = 10;
      const claimed = await claimDueJobs(batchSize);
      for (const jobId of claimed) {
        processed += 1;
        const job = await loadJob(jobId.id);
        if (!job) continue;
        try {
          const result = await relay.send(job);
          if (result.accepted) {
            await markSent(job.id, result.deliveryId);
          } else if (result.permanent) {
            await markFailed(job.id, result.message ?? "relay rejected permanently");
          } else {
            await markDeferred(job.id, result.message ?? "relay deferred");
          }
        } catch (err) {
          await markDeferred(job.id, err instanceof Error ? err.message : String(err));
        }
      }
    } catch (err) {
      console.warn("[outbound:worker] run failed", err instanceof Error ? err.message : err);
    } finally {
      running = false;
    }
    return processed;
  };

  const start = (): void => {
    if (timer) return;
    timer = setInterval(() => {
      void runOnce();
    }, intervalMs);
    void runOnce();
  };

  const stop = (): void => {
    if (timer) clearInterval(timer);
    timer = undefined;
  };

  return { start, stop, runOnce };
}

let worker: OutboundWorker | undefined;

export function getOutboundWorker(): OutboundWorker {
  if (!worker) {
    worker = createOutboundWorker(config.outbound.relay === "null" ? 10_000 : 5_000);
  }
  return worker;
}