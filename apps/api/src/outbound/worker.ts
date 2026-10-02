import { config } from "../config.js";
import { reconcilePreparing } from "./reconcile.js";
import { getRelay, isInvalidHeaderError } from "./relay.js";
import { clearOutboundAttachmentPayloads, loadOutboundAttachmentPayloads } from "./attachmentPayloadStore.js";
import { claimDueJobs, loadJob, markAccepted, markFailed, markTransportRetry } from "./queue.js";
import { scheduleNextRecurringOccurrence, scheduledMetadata } from "./schedule.js";
import { moveScheduledEmailToSent } from "./scheduledStalwart.js";
import type { RelayAttachment } from "./types.js";

export interface OutboundWorker {
  start(): void;
  stop(): void;
  runOnce(): Promise<number>;
}

async function resolveRelayAttachments(job: import("./types.js").OutboundJob): Promise<RelayAttachment[] | undefined> {
  if (!job.attachments?.length) return undefined;
  const payloads = await loadOutboundAttachmentPayloads(job.id);
  if (payloads.length !== job.attachments.length) {
    throw new Error(`attachment payloads unavailable for ${job.id}: expected ${job.attachments.length}, found ${payloads.length}`);
  }
  return payloads;
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
            const schedule = await scheduledMetadata(job.id);
            await markAccepted(job.id, result.deliveryId);

            // Recurring sends need their next staged Email object while the current
            // occurrence and attachment payloads still exist. Failure to prepare a
            // later occurrence never changes the fact that this occurrence sent.
            if (schedule?.kind === "recurring") {
              try {
                const nextId = await scheduleNextRecurringOccurrence(job.id);
                console.info("[outbound:schedule] recurring occurrence prepared", { sendId: job.id, nextSendId: nextId, seriesId: schedule.seriesId });
              } catch (error) {
                console.warn("[outbound:schedule] could not prepare next recurring occurrence", {
                  sendId: job.id,
                  seriesId: schedule.seriesId,
                  error: error instanceof Error ? error.message : String(error),
                });
              }
            }

            if (schedule && job.messageId) {
              const engineMessageId = (await loadJob(job.id))?.messageId ? (await import("../db/client.js"), undefined) : undefined;
              void engineMessageId;
            }
            if (schedule) {
              try {
                const refreshed = await loadJob(job.id);
                const rowEngineId = await (async () => {
                  const { db } = await import("../db/client.js");
                  const { outboundMessages } = await import("../db/schema.js");
                  const { eq } = await import("drizzle-orm");
                  const [row] = await db.select({ engineMessageId: outboundMessages.engineMessageId }).from(outboundMessages).where(eq(outboundMessages.id, job.id)).limit(1);
                  return row?.engineMessageId ?? null;
                })();
                void refreshed;
                if (rowEngineId) await moveScheduledEmailToSent({ productAccountId: job.accountId, address: job.fromAddress, engineMessageId: rowEngineId });
              } catch (error) {
                console.warn("[outbound:schedule] sent copy finalization failed", { sendId: job.id, error: error instanceof Error ? error.message : String(error) });
              }
            }
            await clearOutboundAttachmentPayloads(job.id);
          } else if (result.permanent) {
            await markFailed(job.id, "relay_rejected", result.message ?? "relay rejected permanently");
          } else {
            await markTransportRetry(job.id, result.message ?? "relay deferred");
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.warn("[outbound:worker] delivery failed", {
            error: message,
            accountId: job.accountId,
            sendId: job.id,
            recipients: { to: job.to, cc: job.cc ?? [], bccCount: job.bcc?.length ?? 0 },
            subject: job.subject ?? "",
            threading: { hasInReplyTo: Boolean(job.inReplyTo), hasReferences: Boolean(job.references) },
          });
          if (isInvalidHeaderError(message)) {
            await markFailed(job.id, "invalid_header", message);
          } else {
            await markTransportRetry(job.id, message);
          }
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
