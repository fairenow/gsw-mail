import type { FastifyInstance } from "fastify";
import { pool } from "../db/client.js";
import {
  stripeBillingConfig, configuredStripeValue, verifyStripeSignature,
  stripeRequest, subscriptionSnapshot, StripeBillingError,
  type StripeSubscription,
} from "../billing/stripeService.js";

type StripeEvent={id:string;type:string;data:{object:Record<string,unknown>}};
const relevantEvents=new Set([
  "checkout.session.completed",
  "customer.subscription.created","customer.subscription.updated","customer.subscription.deleted",
  "invoice.paid","invoice.payment_failed",
]);
const refId=(value:unknown):string|null=>{
  if(typeof value==="string")return value;
  if(value&&typeof value==="object"&&"id" in value&&typeof value.id==="string")return value.id;
  return null;
};
const subscriptionId=(event:StripeEvent):string|null=>{
  const object=event.data.object;
  if(event.type.startsWith("customer.subscription."))return refId(object.id);
  if(event.type==="checkout.session.completed")return refId(object.subscription);
  if(event.type.startsWith("invoice.")){
    const parent=object.parent as {subscription_details?:{subscription?:unknown}}|undefined;
    return refId(parent?.subscription_details?.subscription)??refId(object.subscription);
  }
  return null;
};

/** Scoped raw JSON parser: signature must be checked over exact bytes, never parsed JSON. */
export default async function stripeWebhook(app:FastifyInstance){
  app.addContentTypeParser("application/json",{parseAs:"buffer"},(_req,body,done)=>done(null,body));
  app.post("/webhooks/stripe",{bodyLimit:1024*1024},async(req,reply)=>{
    reply.header("Cache-Control","no-store");
    if(!configuredStripeValue(stripeBillingConfig.webhookSecret))return reply.code(503).send({error:"stripe_webhook_not_configured"});
    try{
      const payload=req.body;
      if(!Buffer.isBuffer(payload))return reply.code(400).send({error:"invalid_webhook_payload"});
      const sig=req.headers["stripe-signature"];
      verifyStripeSignature(payload,typeof sig==="string"?sig:undefined);
      const event=JSON.parse(payload.toString("utf8")) as StripeEvent;
      if(typeof event.id!=="string"||!/^evt_[a-zA-Z0-9]+$/.test(event.id)||typeof event.type!=="string"||!event.data?.object)
        return reply.code(400).send({error:"invalid_stripe_event"});
      if(!relevantEvents.has(event.type))return {received:true,ignored:true};
      const id=subscriptionId(event);
      if(!id)return {received:true,ignored:true};
      // Fetch current Stripe state, not the event's possibly outdated snapshot.
      // A deleted subscription event may be the final available snapshot.
      let subscription:StripeSubscription;
      try{
        subscription=await stripeRequest<StripeSubscription>("GET","subscriptions/"+encodeURIComponent(id));
      }catch(error){
        if(event.type==="customer.subscription.deleted"&&event.data.object.id===id)
          subscription=event.data.object as unknown as StripeSubscription;
        else throw error;
      }
      const customer=refId(subscription.customer);
      if(!customer)throw new StripeBillingError(422,"stripe_subscription_customer_missing");
      const snapshot=subscriptionSnapshot(subscription);
      const client=await pool.connect();
      try{
        await client.query("BEGIN");
        // Lock the customer / subscription across concurrent webhook deliveries.
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))",[customer]);
        const already=await client.query("SELECT 1 FROM billing_processed_events WHERE stripe_event_id=$1",[event.id]);
        if(already.rowCount){await client.query("COMMIT");return {received:true,duplicate:true};}
        const workspace=await client.query<{organization_id:string;legacy:boolean}>(
          "SELECT o.id AS organization_id,o.legacy_free_for_life AS legacy FROM billing_customers c "+
          "JOIN organizations o ON o.id=c.organization_id WHERE c.stripe_customer_id=$1",[customer]);
        if(!workspace.rows[0]){
          req.log.warn({eventId:event.id,type:event.type},"Stripe billing event has no matching workspace");
          // Do not mark as processed: allow Stripe to retry when customer mapping is repaired.
          await client.query("ROLLBACK");
          return reply.code(503).send({error:"billing_customer_unmapped"});
        }
        const organizationId=workspace.rows[0].organization_id;
        if(!workspace.rows[0].legacy){
          await client.query(
            "INSERT INTO billing_subscriptions (organization_id,stripe_subscription_id,status,billing_interval,mailbox_quantity,ai_quantity,current_period_end,updated_at) "+
            "VALUES ($1,$2,$3,$4,$5,$6,$7,now()) "+
            "ON CONFLICT (organization_id) DO UPDATE SET stripe_subscription_id=EXCLUDED.stripe_subscription_id,"+
            "status=EXCLUDED.status,billing_interval=EXCLUDED.billing_interval,mailbox_quantity=EXCLUDED.mailbox_quantity,"+
            "ai_quantity=EXCLUDED.ai_quantity,current_period_end=EXCLUDED.current_period_end,updated_at=now()",
            [organizationId,subscription.id,subscription.status,snapshot.interval,snapshot.mailboxes,snapshot.aiSeats,snapshot.periodEnd]);
        }
        await client.query("INSERT INTO billing_processed_events (stripe_event_id,event_type) VALUES ($1,$2)",[event.id,event.type]);
        await client.query("COMMIT");
      }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
      return {received:true};
    }catch(error){
      if(error instanceof StripeBillingError){
        return reply.code(error.status).send({error:error.code});
      }
      req.log.error({err:error},"Stripe webhook failed");
      return reply.code(500).send({error:"stripe_webhook_failed"});
    }
  });
}
