import { confirmationSummaryForAction, permissionCopyForScope } from "./actionDisplay.js";
import { requireAccountPermission } from "../auth/authorize.js";
import {
  completeAiIdempotency,
  failAiIdempotency,
  listActiveAiScopes,
  requestAiConfirmation,
  reserveAiIdempotency,
} from "./agentState.js";
import { scopeConfirmationPolicy, type AiScope } from "./permissions/types.js";
import { getAiCapabilitySettings, isAiScopeGloballyEnabled } from "./capabilities.js";
import { AgentToolRegistry } from "./tools/registry.js";
import type { AgentExecutionContext, AgentToolResult } from "./tools/types.js";

export type AgentIntervention =
  | {
      type: "permission";
      scope: AiScope;
      title: string;
      description: string;
    }
  | {
      type: "confirmation";
      confirmationId: string;
      action: string;
      summary: string;
    };

export type AgentExecutionOutcome =
  | { kind: "result"; result: AgentToolResult }
  | { kind: "intervention"; intervention: AgentIntervention };

const permissionCopy = (scope: AiScope) => {
  if (scope === "mail.read") {
    return {
      title: "Allow GSW Chat to read this mailbox?",
      description: "This lets GSW Chat search and read messages in the currently selected mailbox when you ask it to.",
    };
  }
  if (scope === "mail.write") {
    return {
      title: "Allow GSW Chat to create and edit drafts?",
      description: "This lets GSW Chat create or update drafts in the selected mailbox. Drafts are not sent automatically.",
    };
  }
  if (scope === "mail.send") {
    return {
      title: "Allow GSW Chat to request email sending?",
      description: "This lets GSW Chat prepare a send action for the selected mailbox. Every send still requires a separate confirmation before it is executed.",
    };
  }
  if (scope === "automations.write") {
    return {
      title: "Allow GSW Chat to create scheduled work?",
      description: "This lets GSW Chat save scheduled tasks that can run when you are away. You will still confirm the exact schedule before it is created.",
    };
  }
  if (scope === "domain.read") {
    return {
      title: "Allow GSW Chat to read domain information?",
      description: "This lets GSW Chat read basic domain details for the selected mailbox. DNS configuration and verification diagnostics are only returned to workspace owners and admins.",
    };
  }
  if (scope === "files.read") {
    return {
      title: "Allow GSW Chat to use your files?",
      description: "This lets GSW Chat find and inspect files in your private GSW Files library when you ask it to.",
    };
  }
  if (scope === "files.write") {
    return {
      title: "Allow GSW Chat to update your files?",
      description: "This lets GSW Chat create or change items in your GSW Files library when you ask it to.",
    };
  }
  if (scope === "images.generate") {
    return {
      title: "Allow GSW Chat to generate images?",
      description: "This lets GSW Chat create new images at your request and save them into your private GSW Files library.",
    };
  }
  if (scope === "campaign.write") {
    return {
      title: "Allow GSW Chat to prepare campaigns?",
      description: "This lets GSW Chat build a campaign audience from your contact tags and prepare campaign content. It does not launch the campaign.",
    };
  }
  if (scope === "campaign.send") {
    return {
      title: "Allow GSW Chat to request campaign launches?",
      description: "This lets GSW Chat prepare a campaign launch. Every launch still requires a separate confirmation before messages are queued.",
    };
  }
  return permissionCopyForScope(scope);
};

export function requiredMailboxPermission(scopes: readonly string[]): "read" | "send" {
  return scopes.some((scope) => scope === "mail.send" || scope === "mail.write") ? "send" : "read";
}

export async function executeAgentTool(input: {
  registry: AgentToolRegistry;
  providerToolName: string;
  rawArguments: string;
  ctx: AgentExecutionContext;
  providerToolCallId: string;
  ledgerToolCallId: string;
  conversationId: string;
  runId: string;
  confirmationApproved?: boolean | undefined;
}): Promise<AgentExecutionOutcome> {
  const definition = input.registry.definition(input.providerToolName);
  if (!definition) {
    return {
      kind: "result",
      result: await input.registry.execute(
        input.providerToolName,
        input.rawArguments,
        input.ctx,
        input.providerToolCallId,
      ),
    };
  }

  // The model's accountId and AI scope grant are not mailbox authorization.
  // Independently re-check membership at the executor boundary for every tool.
  if (input.ctx.accountId) {
    const permission = requiredMailboxPermission(definition.requiredScopes);
    try {
      await requireAccountPermission(input.ctx.userId, input.ctx.accountId, permission);
    } catch {
      return {
        kind: "result",
        result: {
          ok: false,
          toolCallId: input.providerToolCallId,
          error: { code: "account_access_denied", message: "You do not have access to the selected mailbox.", retryable: false },
          audit: { userId: input.ctx.userId, accountId: input.ctx.accountId, startedAt: new Date().toISOString(), completedAt: new Date().toISOString() },
        },
      };
    }
  } else if (definition.requiredScopes.some((scope) => scope.startsWith("mail."))) {
    return {
      kind: "result",
      result: {
        ok: false,
        toolCallId: input.providerToolCallId,
        error: { code: "mailbox_required", message: "Select an authorized mailbox to use this action.", retryable: false },
        audit: { userId: input.ctx.userId, accountId: input.ctx.accountId, startedAt: new Date().toISOString(), completedAt: new Date().toISOString() },
      },
    };
  }

  const capabilitySettings = await getAiCapabilitySettings(input.ctx.userId);
  const disabledScope = definition.requiredScopes.find((scope) => !isAiScopeGloballyEnabled(capabilitySettings, scope));
  if (disabledScope) {
    return {
      kind: "result",
      result: {
        ok: false,
        toolCallId: input.providerToolCallId,
        error: { code: "capability_disabled", message: `AI capability ${disabledScope} is disabled in Settings.`, retryable: false },
        audit: { userId: input.ctx.userId, accountId: input.ctx.accountId, startedAt: new Date().toISOString(), completedAt: new Date().toISOString() },
      },
    };
  }

  const activeScopes = await listActiveAiScopes(input.ctx.userId, input.ctx.accountId);
  const granted = new Set(activeScopes.map((grant) => grant.scope));
  const missingScope = definition.requiredScopes.find((scope) => !granted.has(scope));
  const confirmationCanAuthorizeExternalSend = definition.risk === "external" && missingScope === "mail.send";
  if (missingScope && !confirmationCanAuthorizeExternalSend) {
    const scope = missingScope as AiScope;
    const copy = permissionCopy(scope);
    return {
      kind: "intervention",
      intervention: {
        type: "permission",
        scope,
        title: copy.title,
        description: copy.description,
      },
    };
  }

  const confirmationScope = definition.requiredScopes.find((scope) => {
    const policy = scopeConfirmationPolicy[scope as AiScope];
    return policy === "always" || (policy === "contextual" && definition.risk === "external");
  });

  if (!input.confirmationApproved && (definition.risk === "external" || confirmationScope)) {
    const confirmation = await requestAiConfirmation({
      conversationId: input.conversationId,
      runId: input.runId,
      toolCallId: input.ledgerToolCallId,
      userId: input.ctx.userId,
      action: definition.name,
      summary: confirmationSummaryForAction(definition.name),
      expiresAt: new Date(Date.now() + 30 * 60_000),
      metadata: { risk: definition.risk, scopes: definition.requiredScopes },
    });
    return {
      kind: "intervention",
      intervention: {
        type: "confirmation",
        confirmationId: confirmation!.id,
        action: definition.name,
        summary: confirmation!.summary,
      },
    };
  }

  const idempotencyKey = `agent:${input.ledgerToolCallId}`;
  if (definition.risk !== "read") {
    const reserved = await reserveAiIdempotency({
      key: idempotencyKey,
      userId: input.ctx.userId,
      accountId: input.ctx.accountId,
      toolCallId: input.ledgerToolCallId,
      toolName: definition.name,
      expiresAt: new Date(Date.now() + 24 * 60 * 60_000),
    });

    if (reserved.reused && reserved.reservation.status === "completed") {
      return {
        kind: "result",
        result: {
          ok: true,
          toolCallId: input.providerToolCallId,
          data: reserved.reservation.result ?? { reused: true },
          audit: {
            userId: input.ctx.userId,
            accountId: input.ctx.accountId,
            startedAt: reserved.reservation.createdAt.toISOString(),
            completedAt: (reserved.reservation.completedAt ?? reserved.reservation.updatedAt).toISOString(),
          },
        },
      };
    }
    if (reserved.reused && reserved.reservation.status === "reserved") {
      return {
        kind: "result",
        result: {
          ok: false,
          toolCallId: input.providerToolCallId,
          error: {
            code: "action_in_progress",
            message: "This action is already being processed.",
            retryable: true,
          },
          audit: {
            userId: input.ctx.userId,
            accountId: input.ctx.accountId,
            startedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
          },
        },
      };
    }
  }

  try {
    const result = await input.registry.execute(
      input.providerToolName,
      input.rawArguments,
      input.ctx,
      input.providerToolCallId,
    );
    if (definition.risk !== "read") {
      const stored = result.data && typeof result.data === "object"
        ? result.data as Record<string, unknown>
        : result.data === undefined
          ? null
          : { value: result.data };
      if (result.ok) await completeAiIdempotency(idempotencyKey, stored);
      else await failAiIdempotency(idempotencyKey, new Error(result.error?.message ?? "tool execution failed"));
    }
    return { kind: "result", result };
  } catch (error) {
    if (definition.risk !== "read") await failAiIdempotency(idempotencyKey, error);
    throw error;
  }
}
