import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { HttpError } from "../lib/errors.js";
import { pool } from "../db/client.js";
import { requireUser } from "../auth/middleware.js";
import { requireOrgPermission } from "../auth/authorize.js";
import { billableMailboxCount, FREE_MAILBOXES_PER_WORKSPACE, quoteBilling } from "../billing/pricing.js";
import { isStripeLiveReady, stripeBillingConfig, stripePriceId, stripeRequest, StripeBillingError } from "../billing/stripeService.js";

const org=z.object({organizationId:z.string().uuid()}).strict();
const selection=org.extend({interval:z.enum(["month","year"]),mailboxes:z.number().int().min(1).max(10000),aiSeats:z.number().int().min(0).max(10000)}).strict();
type StripeCustomer={id:string};
type StripeSession={url:string|null};

export default async function billingRoutes(app:FastifyInstance){
  await requireUser(app,{optional:false});
  const getStatus=async(userId:string,organizationId:string)=>{
    await requireOrgPermission(userId,organizationId,["owner","admin"]);
    const result=await pool.query<{
      legacy:boolean; operator_exempt:boolean; provisioned:string; customer:string|null; subscription:string|null;
      status:string|null; interval:string|null; mailboxes:number|null; ai:number|null; period_end:Date|null;
    }>("SELECT o.legacy_free_for_life AS legacy, EXISTS (SELECT 1 FROM billing_mailbox_exemptions e WHERE e.organization_id=o.id) AS operator_exempt, "+
      "(SELECT count(*)::text FROM email_accounts ea WHERE ea.workspace_id=o.id AND ea.account_status != 'disabled') AS provisioned, "+
      "c.stripe_customer_id AS customer,s.stripe_subscription_id AS subscription,s.status,s.billing_interval AS interval, "+
      "s.mailbox_quantity AS mailboxes,s.ai_quantity AS ai,s.current_period_end AS period_end "+
      "FROM organizations o LEFT JOIN billing_customers c ON c.organization_id=o.id "+
      "LEFT JOIN billing_subscriptions s ON s.organization_id=o.id WHERE o.id=$1",[organizationId]);
    const row=result.rows[0];
    if(!row) throw new StripeBillingError(404,"workspace_not_found");
    return {organizationId,legacyFreeForLife:row.operator_exempt,operatorExempt:row.operator_exempt,
      includedFreeMailboxes:FREE_MAILBOXES_PER_WORKSPACE,
      billableMailboxes:row.operator_exempt ? 0 : billableMailboxCount(Number(row.provisioned)),
      provisionedMailboxes:Number(row.provisioned),
      stripeCustomerExists:Boolean(row.customer),
      subscription:row.subscription ? {id:row.subscription,status:row.status,interval:row.interval,mailboxes:row.mailboxes,aiSeats:row.ai,currentPeriodEnd:row.period_end}:null,
      checkoutEnabled:stripeBillingConfig.checkoutEnabled && isStripeLiveReady(),
      stripeConfigured:isStripeLiveReady()};
  };
  app.get("/admin/billing",async req=>{
    const {organizationId}=org.parse(req.query);
    return getStatus(req.user!.id,organizationId);
  });
  app.post("/admin/billing/checkout",async(req,reply)=>{
    const input=selection.parse(req.body);
    const state=await getStatus(req.user!.id,input.organizationId);
    if(state.operatorExempt) throw new StripeBillingError(409,"operator_exempt_workspace");
    if(!state.checkoutEnabled) throw new StripeBillingError(503,"checkout_not_enabled");
    if(state.subscription && ["active","trialing","past_due","incomplete"].includes(state.subscription.status||""))
      throw new StripeBillingError(409,"existing_subscription_use_portal");
    if(input.mailboxes<state.provisionedMailboxes) throw new StripeBillingError(422,"mailboxes_below_provisioned");
    const quote = quoteBilling(input.mailboxes,input.aiSeats,input.interval);
    if (quote.paidMailboxes === 0 && input.aiSeats === 0)
      throw new StripeBillingError(409,"first_mailbox_is_free_no_checkout_required");
    const url=new URL(stripeBillingConfig.publicUrl);
    if(url.protocol!=="https:"||url.username||url.password||url.search||url.hash)throw new StripeBillingError(503,"billing_return_url_invalid");
    const existing=await pool.query<{stripe_customer_id:string}>(
      "SELECT stripe_customer_id FROM billing_customers WHERE organization_id=$1",[input.organizationId]);
    let customerId=existing.rows[0]?.stripe_customer_id;
    if(!customerId){
      const customer=await stripeRequest<StripeCustomer>("POST","customers",new URLSearchParams({
        "metadata[organization_id]":input.organizationId,"description":"GSW Mail workspace billing",
      }));
      const inserted=await pool.query<{stripe_customer_id:string}>(
        "INSERT INTO billing_customers (organization_id,stripe_customer_id) VALUES ($1,$2) "+
        "ON CONFLICT (organization_id) DO UPDATE SET organization_id=EXCLUDED.organization_id RETURNING stripe_customer_id",
        [input.organizationId,customer.id]);
      customerId=inserted.rows[0]?.stripe_customer_id;
    }
    if(!customerId)throw new StripeBillingError(500,"billing_customer_unavailable");
    const params=new URLSearchParams({
      mode:"subscription",customer:customerId,
      "success_url":new URL("/control-center#billing",url).toString(),
      "cancel_url":new URL("/control-center#billing",url).toString(),
      "client_reference_id":input.organizationId,
      "metadata[organization_id]":input.organizationId,
      "subscription_data[metadata][organization_id]":input.organizationId,
    });
    let itemIndex = 0;
    if (quote.paidMailboxes > 0) {
      params.set(`line_items[${itemIndex}][price]`, stripePriceId("mailbox", input.interval));
      params.set(`line_items[${itemIndex}][quantity]`, String(quote.paidMailboxes));
      itemIndex++;
    }
    if(input.aiSeats){
      params.set(`line_items[${itemIndex}][price]`,stripePriceId("ai",input.interval));
      params.set(`line_items[${itemIndex}][quantity]`,String(input.aiSeats));
    }
    const session=await stripeRequest<StripeSession>("POST","checkout/sessions",params);
    if(!session.url||!session.url.startsWith("https://checkout.stripe.com/"))throw new StripeBillingError(502,"checkout_url_invalid");
    reply.header("Cache-Control","no-store");
    return {url:session.url};
  });
  app.post("/admin/billing/portal",async(req,reply)=>{
    const {organizationId}=org.parse(req.body);
    const state=await getStatus(req.user!.id,organizationId);
    if(state.operatorExempt)throw new StripeBillingError(409,"operator_exempt_workspace");
    if(!stripeBillingConfig.checkoutEnabled||!isStripeLiveReady())throw new StripeBillingError(503,"checkout_not_enabled");
    const customer=await pool.query<{stripe_customer_id:string}>("SELECT stripe_customer_id FROM billing_customers WHERE organization_id=$1",[organizationId]);
    const customerId=customer.rows[0]?.stripe_customer_id;
    if(!customerId)throw new StripeBillingError(404,"billing_customer_not_found");
    const url=new URL(stripeBillingConfig.publicUrl);
    if(url.protocol!=="https:")throw new StripeBillingError(503,"billing_return_url_invalid");
    const session=await stripeRequest<StripeSession>("POST","billing_portal/sessions",
      new URLSearchParams({customer:customerId,return_url:new URL("/control-center#billing",url).toString()}));
    if(!session.url||!session.url.startsWith("https://billing.stripe.com/"))throw new StripeBillingError(502,"portal_url_invalid");
    reply.header("Cache-Control","no-store");
    return {url:session.url};
  });
  app.setErrorHandler((err,req,reply)=>{
    if(err instanceof StripeBillingError)return reply.status(err.status).send({error:err.code});
    if(err instanceof HttpError)return reply.status(err.status).send({error:err.message});
    if(err instanceof ZodError)return reply.status(400).send({error:"invalid_billing_request"});
    req.log.error({err},"admin billing error");
    return reply.status(500).send({error:"billing_error"});
  });
}
