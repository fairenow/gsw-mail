/**
 * GSW Mail launch pricing. All amounts in USD cents.
 * Domain administration, domain creation and MCP integrations are free.
 * Each provisioned mailbox is a separate Core billing unit.
 * Paid AI is optional per licensed mailbox; outside model providers connected via MCP are not billable AI seats.
 */
export type BillingInterval = "month" | "year";
export type BillingProduct = "mailbox" | "ai";
export const BILLING_PRICES = {
  mailbox: { month: 250, year: 1500 },
  ai: { month: 2500, year: 12500 },
} as const;
export const MAILBOX_STORAGE_BYTES = 5_000_000_000;
export const BILLING_DEFAULTS = {
  mailboxStorageBytes: MAILBOX_STORAGE_BYTES,
  apiRequestsPerMailboxPerMonth: 10_000,
  mcpCallsPerMailboxPerMonth: 5_000,
  emailSendsPerMailboxPerMonth: 500,
} as const;

export function quoteBilling(mailboxes: number, aiSeats: number, interval: BillingInterval) {
  if (!Number.isSafeInteger(mailboxes) || mailboxes < 0) throw new Error("mailboxes must be a nonnegative integer");
  if (!Number.isSafeInteger(aiSeats) || aiSeats < 0 || aiSeats > mailboxes) throw new Error("AI seats cannot exceed mailbox count");
  const mailboxCents = mailboxes * BILLING_PRICES.mailbox[interval];
  const aiCents = aiSeats * BILLING_PRICES.ai[interval];
  if (!Number.isSafeInteger(mailboxCents + aiCents)) throw new Error("amount exceeds safe integer range");
  return { interval, mailboxes, aiSeats, mailboxCents, aiCents, totalCents: mailboxCents + aiCents, currency: "usd" as const };
}

export function isLegacyUnlimited(legacyUser: boolean, legacyWorkspace: boolean): boolean {
  return legacyUser || legacyWorkspace;
}
