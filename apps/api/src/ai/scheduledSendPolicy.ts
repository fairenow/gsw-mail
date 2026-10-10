import { createHash } from "node:crypto";

export interface ScheduledSendPolicy {
  enabled: boolean;
  approvedAt: string;
  approvedBy: string;
  allowedRecipients: string[];
  version: number;
}

export function scheduledSendRecipientsAllowed(
  policy: ScheduledSendPolicy | null | undefined,
  recipients: readonly string[],
): boolean {
  if (!policy?.enabled || recipients.length === 0) return false;
  const allowed = new Set(policy.allowedRecipients.map(value => value.trim().toLowerCase()));
  return recipients.every(value => allowed.has(value.trim().toLowerCase()));
}

/** A mailbox draft may be sent once across all automations, including retries. */
export function scheduledSendKey(automationId: string, accountId: string, draftId: string): string {
  void automationId;
  const digest = createHash("sha256").update(JSON.stringify([accountId, draftId])).digest("hex");
  return `scheduled-send:v1:${digest}`;
}
