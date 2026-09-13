import { config } from "../config.js";
import { getServiceEngine } from "../engine/index.js";
import { reconcilePreparing } from "./reconcile.js";
import { getRelay } from "./relay.js";
import { claimDueJobs, loadJob, markAccepted, markFailed, markTransportRetry } from "./queue.js";
import type { RelayAttachment } from "./types.js";

export interface OutboundWorker {
  start(): void;
  stop(): void;
  runOnce(): Promise<number>;
}

async function resolveRelayAttachments(job: import("./types.js").OutboundJob): Promise<RelayAttachment[] | undefined> {
  if (!job.attachments?.length) return undefined;
  const engine = getServiceEngine();
  const resolved: RelayAttachment[] = [];
  for (const a of job.attachments) {
    if (!a.engineAttachmentId) throw new Error(`attachment ${a.filename} has no engine blob`);
    const body = await engine.getAttachment(job.accountId, a.engineAttachmentId);
    if (!body) {
      throw new Error(`attachment ${a.filename} missing in engine for ${job.id}`);
    }
    resolved.push({
      filename: a.filename,
      contentType: a.contentType ?? (body.contentType || "application/octet-stream"),
      content: body.content,
      contentId: a.contentId ?? undefined,
    });
  }
  return resolved;
}

export function createOutboundWorker(intervalMs = 5_000): OutboundWorker {
  const relay = getRelay();
  let timer: NodeJS.Timeout | undefined;
  let running = false;
  let ticks = 0;

  const runOnce = async (): Promise<number> => {
    if (running) return 0;
    running = true;
    let processed = 0;
    try {
      ticks += 1;
      if (ticks % 12 === 0) {
        await reconcilePreparing();
      }
      const batchSize = 10;
      const claimed = await claimDueJobs(batchSize);
      for (const jobId of claimed) {
        processed += 1;
        const job = await loadJob(jobId.id);
        if (!job) continue;
        try {
           const relayAttachments = await resolveRelayAttachments(job);
           const result = await relay.send(job, relayAttachments);
           console.info("[outbound:worker] relay result", {
             sendId: job.id,
             accountId: job.accountId,
             accepted: result.accepted,
             permanent: result.permanent ?? false,
             deliveryId: result.deliveryId,
             message: result.message,
           });
           if (result.accepted) {
            await markAccepted(job.id, result.deliveryId);
          } else if (result.permanent) {
            await markFailed(job.id, "relay_rejected", result.message ?? "relay rejected permanently");
          } else {
            await markTransportRetry(job.id, result.message ?? "relay deferred");
          }
         } catch (err) {
           console.warn("[outbound:worker] delivery failed", {
             error: err instanceof Error ? err.message : String(err),
             accountId: job.accountId,
             sendId: job.id,
             recipients: { to: job.to, cc: job.cc ?? [], bccCount: job.bcc?.length ?? 0 },
             subject: job.subject ?? "",
             threading: { hasInReplyTo: Boolean(job.inReplyTo), hasReferences: Boolean(job.references) },
           });
           await markTransportRetry(job.id, err instanceof Error ? err.message : String(err));
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
