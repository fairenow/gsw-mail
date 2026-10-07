import { and, eq } from "drizzle-orm";
import { requireAccountPermission } from "../../auth/authorize.js";
import { db } from "../../db/client.js";
import { domainDnsState } from "../../db/domainDnsSchema.js";
import { domains, organizationMemberships } from "../../db/schema.js";
import type { AgentExecutionContext, AgentToolDefinition, AgentToolResult } from "./types.js";

const success = <T>(ctx: AgentExecutionContext, toolCallId: string, startedAt: string, data: T): AgentToolResult<T> => ({
  ok: true,
  toolCallId,
  data,
  audit: {
    userId: ctx.userId,
    accountId: ctx.accountId,
    startedAt,
    completedAt: new Date().toISOString(),
  },
});

const failure = (ctx: AgentExecutionContext, toolCallId: string, startedAt: string, error: unknown): AgentToolResult => ({
  ok: false,
  toolCallId,
  error: {
    code: "tool_failed",
    message: error instanceof Error ? error.message : String(error),
    retryable: false,
  },
  audit: {
    userId: ctx.userId,
    accountId: ctx.accountId,
    startedAt,
    completedAt: new Date().toISOString(),
  },
});

export const domainReadTool: AgentToolDefinition = {
  name: "domain.read",
  description: "Read domain information for the currently selected mailbox. Regular mailbox users receive a safe summary. Workspace owners and admins also receive DNS configuration and health details.",
  inputSchema: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  requiredScopes: ["domain.read"],
  risk: "read",
  async execute(ctx, _rawInput, toolCallId) {
    const startedAt = new Date().toISOString();
    try {
      const account = await requireAccountPermission(ctx.userId, ctx.accountId, "read");
      const [row] = await db.select({
        id: domains.id,
        name: domains.name,
        status: domains.status,
        mxStatus: domains.mxStatus,
        spfStatus: domains.spfStatus,
        dkimStatus: domains.dkimStatus,
        dmarcStatus: domains.dmarcStatus,
        dkimSelector: domains.dkimSelector,
        updatedAt: domains.updatedAt,
        expectedRecords: domainDnsState.expectedRecords,
        observedRecords: domainDnsState.observedRecords,
        lastCheckedAt: domainDnsState.lastCheckedAt,
        lastHealthyAt: domainDnsState.lastHealthyAt,
        lastError: domainDnsState.lastError,
      })
        .from(domains)
        .leftJoin(domainDnsState, eq(domainDnsState.domainId, domains.id))
        .where(eq(domains.id, account.domainId))
        .limit(1);

      if (!row) throw new Error("domain not found");

      const [membership] = await db.select({
        role: organizationMemberships.role,
        status: organizationMemberships.status,
      })
        .from(organizationMemberships)
        .where(and(
          eq(organizationMemberships.organizationId, account.organizationId),
          eq(organizationMemberships.userId, ctx.userId),
        ))
        .limit(1);

      const adminAccess = membership?.status === "active" && (membership.role === "owner" || membership.role === "admin");
      const summary = {
        accessLevel: adminAccess ? "admin" : "member",
        domain: row.name,
        status: row.status,
        mailboxAddress: account.address,
        mailboxRole: account.role,
      };

      if (!adminAccess) {
        return success(ctx, toolCallId, startedAt, {
          ...summary,
          detail: "Basic domain information is available because this user can read the selected mailbox. DNS records, selectors, provider diagnostics, and verification details are restricted to workspace owners and admins.",
        });
      }

      return success(ctx, toolCallId, startedAt, {
        ...summary,
        dns: {
          mxStatus: row.mxStatus,
          spfStatus: row.spfStatus,
          dkimStatus: row.dkimStatus,
          dmarcStatus: row.dmarcStatus,
          dkimSelector: row.dkimSelector,
          expectedRecords: row.expectedRecords ?? [],
          observedRecords: row.observedRecords ?? [],
          lastCheckedAt: row.lastCheckedAt,
          lastHealthyAt: row.lastHealthyAt,
          lastError: row.lastError,
          updatedAt: row.updatedAt,
        },
      });
    } catch (error) {
      return failure(ctx, toolCallId, startedAt, error);
    }
  },
};

export const domainTools: AgentToolDefinition[] = [domainReadTool];
