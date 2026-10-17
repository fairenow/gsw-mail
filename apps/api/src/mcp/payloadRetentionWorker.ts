import { purgeExpiredMcpDraftPayloads } from "./draftPayloadStore.js";

const CLEANUP_INTERVAL_MS = 5 * 60_000;

/**
 * Periodically delete expired encrypted draft arguments. The approval audit
 * ledger remains intact. No plaintext payload is logged.
 *
 * The cleanup is safe to run on multiple API instances: deletes are idempotent.
 * An in-process guard prevents overlapping runs in the same instance.
 */
export function startMcpPayloadRetentionWorker(
  onError: (error: unknown) => void,
  onCleanup?: (count: number) => void,
): () => void {
  let stopped = false;
  let running = false;
  const cleanup = async () => {
    if (stopped || running) return;
    running = true;
    try {
      const deleted = await purgeExpiredMcpDraftPayloads();
      if (deleted > 0) onCleanup?.(deleted);
    } catch (error) {
      onError(error);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => { void cleanup(); }, CLEANUP_INTERVAL_MS);
  timer.unref();
  void cleanup();
  return () => { stopped = true; clearInterval(timer); };
}
