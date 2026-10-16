import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { aiIdempotencyKeys } from "../db/schema.js";

type CommandRecord = {
  fingerprint: string;
  conversationId?: string;
  response?: unknown;
  activity?: { label:string; phase:string; updatedAt:string };
};

const keyFor = (userId: string, commandId: string) => `chat-command:${userId}:${commandId}`;
const fingerprint = (payload: unknown) => createHash("sha256").update(JSON.stringify(payload)).digest("hex");
const asRecord = (value: unknown): CommandRecord => value && typeof value === "object" ? value as CommandRecord : { fingerprint: "" };

export async function reserveChatCommand(input: { userId: string; commandId: string; accountId?: string; payload: unknown }) {
  const key = keyFor(input.userId, input.commandId);
  const hash = fingerprint(input.payload);
  const [inserted] = await db.insert(aiIdempotencyKeys).values({
    key, userId: input.userId, accountId: input.accountId ?? null,
    toolName: "chat.command", status: "reserved", result: { fingerprint: hash },
  }).onConflictDoNothing({ target: aiIdempotencyKeys.key }).returning();
  if (inserted) return { status: "new" as const, key };
  const [existing] = await db.select().from(aiIdempotencyKeys).where(eq(aiIdempotencyKeys.key, key)).limit(1);
  if (!existing || existing.userId !== input.userId || existing.toolName !== "chat.command" || existing.accountId !== (input.accountId ?? null)) {
    throw new Error("Chat command reservation conflict");
  }
  const record = asRecord(existing.result);
  if (record.fingerprint !== hash) throw new Error("Chat command ID was already used for different content");
  return { status: existing.status, key, record };
}

export async function updateChatCommand(key: string, status: "reserved" | "completed" | "uncertain", change: Partial<CommandRecord>) {
  const [existing] = await db.select().from(aiIdempotencyKeys).where(eq(aiIdempotencyKeys.key, key)).limit(1);
  if (!existing) throw new Error("Chat command not found");
  const record = { ...asRecord(existing.result), ...change };
  await db.update(aiIdempotencyKeys).set({
    status, result: record, updatedAt: new Date(),
    ...(status === "completed" ? { completedAt: new Date() } : {}),
  }).where(eq(aiIdempotencyKeys.key, key));
}

export async function getChatCommand(userId: string, commandId: string) {
  const [record] = await db.select().from(aiIdempotencyKeys)
    .where(eq(aiIdempotencyKeys.key, keyFor(userId, commandId))).limit(1);
  if (!record || record.userId !== userId || record.toolName !== "chat.command") return null;
  const result = asRecord(record.result);
  const stale = record.status === "reserved" && Date.now() - new Date(record.updatedAt).getTime() > 30 * 60 * 1000;
  return {
    status: record.status === "completed" ? "completed" : record.status === "uncertain" || stale ? "uncertain" : "processing",
    conversationId: result.conversationId ?? null,
    response: record.status === "completed" ? result.response ?? null : null,
    activity: result.activity ?? null,
  };
}
