export function hasPaidMeetingAccess(subscription: { status: string; mailbox_quantity: number; current_period_end: Date | string | null } | undefined, now = Date.now()): boolean {
  if (!subscription || !["active", "trialing"].includes(subscription.status) || subscription.mailbox_quantity < 1 || !subscription.current_period_end) return false;
  return new Date(subscription.current_period_end).getTime() > now;
}
