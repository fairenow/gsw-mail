import { createHmac, timingSafeEqual } from "node:crypto";

export type StripeBillingInterval = "month" | "year";
type PriceKind = "mailbox" | "ai";

export const stripeBillingConfig = {
  secretKey: process.env.STRIPE_SECRET_KEY ?? "",
  webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? "",
  checkoutEnabled: process.env.STRIPE_CHECKOUT_ENABLED === "true",
  publicUrl: process.env.GSW_MAIL_PUBLIC_URL ?? "https://mail.guidedstepswellness.com",
  priceIds: {
    mailbox: { month: process.env.STRIPE_MAILBOX_MONTHLY_PRICE_ID ?? "", year: process.env.STRIPE_MAILBOX_ANNUAL_PRICE_ID ?? "" },
    ai: { month: process.env.STRIPE_AI_MONTHLY_PRICE_ID ?? "", year: process.env.STRIPE_AI_ANNUAL_PRICE_ID ?? "" },
  },
};

export const configuredStripeValue = (value: string): boolean => Boolean(value && !value.startsWith("REPLACE_WITH_"));
export const isStripeLiveReady = (): boolean => configuredStripeValue(stripeBillingConfig.secretKey) &&
  (["month", "year"] as const).every(period => (["mailbox", "ai"] as const).every(kind => configuredStripeValue(stripeBillingConfig.priceIds[kind][period])));

export class StripeBillingError extends Error {
  constructor(readonly status: number, readonly code: string, message = code) { super(message); }
}

export async function stripeRequest<T>(method: "GET"|"POST", path: string, params?: URLSearchParams): Promise<T> {
  if (!configuredStripeValue(stripeBillingConfig.secretKey)) throw new StripeBillingError(503, "stripe_not_configured");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(`https://api.stripe.com/v1/${path.replace(/^\//, "")}`, {
      method,
      headers: {
        Authorization: `Bearer ${stripeBillingConfig.secretKey}`,
        ...(method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
        "Stripe-Version": "2025-08-27.basil",
      },
      ...(method === "POST" && params ? { body: params } : {}),
      signal: controller.signal,
    });
    const json = await response.json() as T & { error?: { type?: string; code?: string; message?: string } };
    if (!response.ok) throw new StripeBillingError(502, "stripe_api_error", json.error?.message ?? "Stripe request failed");
    return json;
  } finally { clearTimeout(timeout); }
}
export function stripePriceId(kind: PriceKind, period: StripeBillingInterval): string {
  const id = stripeBillingConfig.priceIds[kind][period];
  if (!configuredStripeValue(id)) throw new StripeBillingError(503, "stripe_price_not_configured");
  return id;
}
export function verifyStripeSignature(payload: Buffer, signature: string|undefined, nowSeconds = Math.floor(Date.now()/1000)): void {
  const secret = stripeBillingConfig.webhookSecret;
  if (!configuredStripeValue(secret)) throw new StripeBillingError(503, "stripe_webhook_not_configured");
  if (!signature) throw new StripeBillingError(400, "stripe_signature_missing");
  const components = signature.split(",").map(x=>x.trim());
  const timestamp = components.find(x=>x.startsWith("t="))?.slice(2);
  const signatures = components.filter(x=>x.startsWith("v1=")).map(x=>x.slice(3));
  if (!timestamp || !/^\d+$/.test(timestamp) || signatures.length===0) throw new StripeBillingError(400, "stripe_signature_invalid");
  const ts = Number(timestamp);
  if (!Number.isSafeInteger(ts) || Math.abs(nowSeconds-ts)>300) throw new StripeBillingError(400, "stripe_signature_expired");
  const digest = createHmac("sha256", secret).update(`${timestamp}.`).update(payload).digest();
  const valid = signatures.some(sig => {
    if (!/^[a-f0-9]{64}$/i.test(sig)) return false;
    const candidate = Buffer.from(sig, "hex");
    return candidate.length===digest.length && timingSafeEqual(candidate, digest);
  });
  if (!valid) throw new StripeBillingError(400, "stripe_signature_invalid");
}
export type StripeSubscription = {
  id: string; customer: string | {id:string}; status: string; cancel_at_period_end?:boolean;
  items: { data: Array<{ id:string; quantity?: number; current_period_end?:number; price:{ id:string; recurring?:{interval:string} } }> };
  current_period_end?: number; metadata?: Record<string,string>;
};
export function subscriptionSnapshot(subscription: StripeSubscription): {
  interval: StripeBillingInterval; mailboxes: number; aiSeats: number; periodEnd:Date|null;
} {
  let mailboxes=0, aiSeats=0;
  let interval: StripeBillingInterval = "month";
  let periodEndSeconds = subscription.current_period_end ?? 0;
  for (const item of subscription.items.data) {
    const period = item.price.recurring?.interval;
    const quantity = item.quantity ?? 0;
    const mailboxPeriod = (["month", "year"] as const).find(p=>stripeBillingConfig.priceIds.mailbox[p]===item.price.id);
    const aiPeriod = (["month", "year"] as const).find(p=>stripeBillingConfig.priceIds.ai[p]===item.price.id);
    if (!mailboxPeriod && !aiPeriod) continue;
    if (period !== mailboxPeriod && period !== aiPeriod) throw new StripeBillingError(422,"stripe_subscription_interval_mismatch");
    if (mailboxPeriod) { mailboxes += quantity; interval = mailboxPeriod; }
    periodEndSeconds = Math.max(periodEndSeconds, item.current_period_end ?? 0);
    if (aiPeriod) aiSeats += quantity;
  }
  // Stripe mailbox quantity contains only PAID seats; the first Core mailbox
  // is included free, but may still purchase one optional AI license.
  if (aiSeats > mailboxes + 1) throw new StripeBillingError(422,"stripe_ai_quantity_exceeds_mailboxes");
  return {interval,mailboxes,aiSeats,periodEnd:periodEndSeconds ? new Date(periodEndSeconds*1000):null};
}
