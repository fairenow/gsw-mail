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

/** A draft may be sent at most once by an automation, including across retries. */
export function scheduledSendKey(automationId: string, accountId: string, draftId: string): string {
  const digest = createHash("sha256").update(JSON.stringify([automationId, accountId, draftId])).digest("hex");
  return `scheduled-send:v1:${digest}`;
}
