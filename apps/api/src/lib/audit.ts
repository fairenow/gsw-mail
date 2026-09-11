import type { FastifyRequest } from "fastify";
import { db } from "../db/client.js";
import { auditEvents } from "../db/schema.js";

export interface AuditInput {
  actorUserId: string;
  organizationId?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  metadata?: Record<string, unknown>;
  request?: FastifyRequest;
}

export async function audit(input: AuditInput): Promise<void> {
  try {
    await db.insert(auditEvents).values({
      actorUserId: input.actorUserId,
      organizationId: input.organizationId,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      metadata: input.metadata,
      ipAddress: input.request?.ip,
      userAgent: input.request?.headers["user-agent"],
    });
  } catch (err) {
    console.warn("[audit] failed to record event", err instanceof Error ? err.message : err);
  }
}