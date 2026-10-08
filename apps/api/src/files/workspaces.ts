import { and, eq } from "drizzle-orm";
import { config } from "../config.js";
import { db } from "../db/client.js";
import { fileWorkspaces } from "../db/schema.js";
import { HttpError } from "../lib/errors.js";

const WORKSPACE_MINUTES = 60;

const ensureOpenAi = () => {
  if (!config.ai.openaiApiKey) {
    throw new HttpError(503, "Persistent file workspaces require OPENAI_API_KEY.");
  }
  return {
    apiKey: config.ai.openaiApiKey,
    baseUrl: config.ai.openaiBaseUrl.replace(/\/$/, ""),
  };
};

async function createContainer(name: string) {
  const { apiKey, baseUrl } = ensureOpenAi();
  const response = await fetch(`${baseUrl}/containers`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      name,
      memory_limit: "4g",
      expires_after: { anchor: "last_active_at", minutes: WORKSPACE_MINUTES },
      network_policy: { type: "disabled" },
    }),
  });
  const body = await response.json().catch(() => ({})) as { id?: string; error?: { message?: string } };
  if (!response.ok || !body.id) {
    throw new HttpError(response.status === 429 ? 429 : 502, body.error?.message?.trim() || `OpenAI container creation returned HTTP ${response.status}`);
  }
  return body.id;
}

const nextExpiry = () => new Date(Date.now() + WORKSPACE_MINUTES * 60_000);

export async function getOrCreateFileWorkspace(userId: string, conversationId: string) {
  const [existing] = await db.select().from(fileWorkspaces).where(and(
    eq(fileWorkspaces.userId, userId),
    eq(fileWorkspaces.conversationId, conversationId),
  )).limit(1);

  if (existing && existing.status === "active" && existing.expiresAt.getTime() > Date.now()) {
    const now = new Date();
    const expiresAt = nextExpiry();
    const [updated] = await db.update(fileWorkspaces).set({
      lastActiveAt: now,
      expiresAt,
      updatedAt: now,
    }).where(eq(fileWorkspaces.id, existing.id)).returning();
    return updated!;
  }

  const containerId = await createContainer(`gsw-${conversationId}`);
  const now = new Date();
  const expiresAt = nextExpiry();

  if (existing) {
    const [updated] = await db.update(fileWorkspaces).set({
      externalContainerId: containerId,
      status: "active",
      memoryLimit: "4g",
      expiresAt,
      lastActiveAt: now,
      updatedAt: now,
    }).where(eq(fileWorkspaces.id, existing.id)).returning();
    return updated!;
  }

  const [created] = await db.insert(fileWorkspaces).values({
    userId,
    conversationId,
    provider: "openai",
    externalContainerId: containerId,
    status: "active",
    memoryLimit: "4g",
    expiresAt,
    lastActiveAt: now,
  }).returning();
  return created!;
}

export async function touchFileWorkspace(workspaceId: string) {
  const now = new Date();
  const [updated] = await db.update(fileWorkspaces).set({
    lastActiveAt: now,
    expiresAt: nextExpiry(),
    updatedAt: now,
  }).where(eq(fileWorkspaces.id, workspaceId)).returning();
  return updated ?? null;
}
