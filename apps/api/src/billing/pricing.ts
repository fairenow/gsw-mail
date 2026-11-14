/**
 * GSW Mail launch pricing. All amounts in USD cents.
 * Domain administration, domain creation and MCP integrations are free.
 * One mailbox per workspace is included free for life; each additional mailbox is a Core billing unit.
 * Paid AI is optional per licensed mailbox; outside model providers connected via MCP are not billable AI seats.
 */
export type BillingInterval = "month" | "year";
export type BillingProduct = "mailbox" | "ai";
export const BILLING_PRICES = {
  mailbox: { month: 250, year: 1500 },
  ai: { month: 2500, year: 12500 },
} as const;
export const FREE_MAILBOXES_PER_WORKSPACE = 1;
export const MAILBOX_STORAGE_BYTES = 5_000_000_000;

export function billableMailboxCount(totalMailboxes: number, freeMailboxes = FREE_MAILBOXES_PER_WORKSPACE): number {
  if (!Number.isSafeInteger(totalMailboxes) || totalMailboxes < 0) throw new Error("mailboxes must be a nonnegative integer");
  if (!Number.isSafeInteger(freeMailboxes) || freeMailboxes < 0) throw new Error("free mailboxes must be a nonnegative integer");
  return Math.max(0, totalMailboxes - freeMailboxes);
}
export const BILLING_DEFAULTS = {
  mailboxStorageBytes: MAILBOX_STORAGE_BYTES,
  apiRequestsPerMailboxPerMonth: 10_000,
  mcpCallsPerMailboxPerMonth: 5_000,
  emailSendsPerMailboxPerMonth: 500,
} as const;

export function quoteBilling(mailboxes: number, aiSeats: number, interval: BillingInterval, freeMailboxes = FREE_MAILBOXES_PER_WORKSPACE) {
  if (!Number.isSafeInteger(mailboxes) || mailboxes < 0) throw new Error("mailboxes must be a nonnegative integer");
  if (!Number.isSafeInteger(aiSeats) || aiSeats < 0 || aiSeats > mailboxes) throw new Error("AI seats cannot exceed mailbox count");
  const paidMailboxes = billableMailboxCount(mailboxes, freeMailboxes);
  const mailboxCents = paidMailboxes * BILLING_PRICES.mailbox[interval];
  const aiCents = aiSeats * BILLING_PRICES.ai[interval];
  if (!Number.isSafeInteger(mailboxCents + aiCents)) throw new Error("amount exceeds safe integer range");
  return { interval, mailboxes, freeMailboxes: Math.min(mailboxes, freeMailboxes), paidMailboxes, aiSeats, mailboxCents, aiCents, totalCents: mailboxCents + aiCents, currency: "usd" as const };
}

// Historic prelaunch legacy flags are retained for audit only. Unlimited Core
// mailboxes now require an explicit operator exemption in the database.
export function isLegacyUnlimited(_legacyUser: boolean, _legacyWorkspace: boolean): boolean {
  return false;
}
