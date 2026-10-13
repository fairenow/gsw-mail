import { and, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { fileNodes, fileOrganizationJobs } from "../db/schema.js";
import { createFolder, moveFileNode } from "../files/service.js";
import { inventory, type Action } from "../ai/tools/fileOrganizationTools.js";

export async function startOrganizationJob(userId: string, planHash: string, dateBasis: "created" | "uploaded") {
  const plan = await inventory(userId, { dateBasis, limit: 50 });
  if (plan.fingerprint !== planHash) throw new Error("File inventory changed. Preview and approve the new plan.");
  const existing = await db.select().from(fileOrganizationJobs).where(and(
    eq(fileOrganizationJobs.userId, userId),
    inArray(fileOrganizationJobs.status, ["queued", "running", "paused"]),
  )).limit(1);
  if (existing[0]) throw new Error("An organization job is already active. Pause, resume or finish it first.");
  const [job] = await db.insert(fileOrganizationJobs).values({
    userId, status: "queued", planHash, dateBasis, actions: plan.actions,
  }).returning();
  return summarize(job!);
}

function summarize(job: typeof fileOrganizationJobs.$inferSelect) {
  return { id: job.id, status: job.status, total: job.actions.length, processed: job.cursor,
    moved: job.movedCount, failed: job.failedCount, remaining: Math.max(0, job.actions.length - job.cursor),
    errors: job.errors.slice(-20), createdAt: job.createdAt, updatedAt: job.updatedAt };
}
export async function getOrganizationJob(userId: string, id: string) {
  const [job] = await db.select().from(fileOrganizationJobs).where(and(
    eq(fileOrganizationJobs.id, id), eq(fileOrganizationJobs.userId, userId),
  )).limit(1);
  if (!job) throw new Error("Organization job not found");
  return summarize(job);
}
export async function changeOrganizationJob(userId: string, id: string, command: "pause" | "resume") {
  const states = command === "pause" ? ["queued", "running"] : ["paused"];
  const [job] = await db.update(fileOrganizationJobs).set({ status: command === "pause" ? "paused" : "queued", leaseUntil: null })
    .where(and(eq(fileOrganizationJobs.userId, userId), eq(fileOrganizationJobs.id, id), inArray(fileOrganizationJobs.status, states))).returning();
  if (!job) throw new Error("Job not found or transition unavailable");
  return summarize(job);
}

async function folder(userId: string, name: string, parentId: string | null) {
  const match = () => db.select({ id: fileNodes.id }).from(fileNodes).where(and(
    eq(fileNodes.userId, userId), eq(fileNodes.nodeType, "folder"), eq(fileNodes.name, name),
    parentId ? eq(fileNodes.parentId, parentId) : isNull(fileNodes.parentId),
    isNull(fileNodes.trashedAt),
  )).limit(1);
  const [existing] = await match();
  if (existing) return existing.id;
  try { return (await createFolder(userId, name, parentId)).id; }
  catch (err) { const [race] = await match(); if (race) return race.id; throw err; }
}
async function moveAction(userId: string, action: Action) {
  const [node] = await db.select({ parentId: fileNodes.parentId, nodeType: fileNodes.nodeType, trashedAt: fileNodes.trashedAt })
    .from(fileNodes).where(and(eq(fileNodes.id, action.nodeId), eq(fileNodes.userId, userId))).limit(1);
  if (!node || node.nodeType !== "file" || node.trashedAt) throw new Error("Original file missing or trashed");
  const day = await folder(userId, action.date, null);
  const type = await folder(userId, action.type, day);
  if (node.parentId === type) return; // Worker crashed after move but before progress save.
  if (node.parentId !== action.from) throw new Error("File moved elsewhere since approval; skipped");
  await moveFileNode(userId, action.nodeId, type);
}

let busy = false;
export async function processOrganizationJobOnce() {
  if (busy) return false;
  busy = true;
  try {
    const leaseUntil = new Date(Date.now() + 120_000);
    // Atomic claim prevents multiple running replicas from processing the same cursor.
    const claimed = await db.execute(sql`
      UPDATE file_organization_jobs SET status = 'running', lease_until = ${leaseUntil}, updated_at = now()
      WHERE id = (
        SELECT id FROM file_organization_jobs
        WHERE status IN ('queued','running') AND (lease_until IS NULL OR lease_until < now())
        ORDER BY created_at ASC FOR UPDATE SKIP LOCKED LIMIT 1
      ) RETURNING id`);
    const id = (claimed.rows[0] as { id?: string } | undefined)?.id;
    if (!id) return false;
    const [job] = await db.select().from(fileOrganizationJobs).where(eq(fileOrganizationJobs.id, id));
    if (!job) return false;
    if (job.cursor >= job.actions.length) {
      await db.update(fileOrganizationJobs).set({ status: job.failedCount ? "completed_with_errors" : "completed", leaseUntil: null }).where(eq(fileOrganizationJobs.id, id));
      return true;
    }
    const action = job.actions[job.cursor]!;
    let failure: string | null = null;
    try { await moveAction(job.userId, action); }
    catch (err) { failure = err instanceof Error ? err.message : "Move failed"; }
    // Pause can be applied while the move is in flight; keep paused state, but record completed step.
    await db.update(fileOrganizationJobs).set({
      cursor: job.cursor + 1,
      movedCount: job.movedCount + (failure ? 0 : 1),
      failedCount: job.failedCount + (failure ? 1 : 0),
      errors: failure ? [...job.errors.slice(-99), { nodeId: action.nodeId, reason: failure }] : job.errors,
      leaseUntil: null,
      status: sql`CASE WHEN ${fileOrganizationJobs.status} = 'paused' THEN 'paused'
        WHEN ${job.cursor + 1} >= ${job.actions.length} THEN ${job.failedCount + (failure ? 1 : 0) ? "completed_with_errors" : "completed"}
        ELSE 'queued' END`,
    }).where(and(eq(fileOrganizationJobs.id, id), eq(fileOrganizationJobs.cursor, job.cursor)));
    return true;
  } finally { busy = false; }
}
export function startOrganizationWorker(onError: (error: unknown) => void) {
  const timer = setInterval(() => { void processOrganizationJobOnce().catch(onError); }, 1500);
  timer.unref();
  void processOrganizationJobOnce().catch(onError);
  return () => clearInterval(timer);
}
