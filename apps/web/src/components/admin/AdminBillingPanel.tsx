import { useEffect, useState } from "react";

type Interval = "month" | "year";
const PRICES = {
  month: { mailbox: 250, ai: 2500 },
  year: { mailbox: 1500, ai: 12500 },
} as const;
const dollars = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);

type BillingState = {
  organizationId:string; legacyFreeForLife:boolean; operatorExempt?:boolean; includedFreeMailboxes?:number; billableMailboxes?:number; provisionedMailboxes:number; checkoutEnabled:boolean; stripeConfigured:boolean;
  subscription:null|{id:string;status:string|null;interval:string|null;mailboxes:number|null;aiSeats:number|null;currentPeriodEnd:string|null};
};
export function AdminBillingPanel({ currentMailboxes, organizationId }: { currentMailboxes: number; organizationId:string }) {
  const [interval, setInterval] = useState<Interval>("year");
  const [billingState, setBillingState] = useState<BillingState|null>(null);
  const [billingError, setBillingError] = useState("");
  const [billingBusy, setBillingBusy] = useState(false);
  useEffect(() => {
    if (!organizationId) return;
    const controller=new AbortController();
    fetch("/admin/billing?organizationId="+encodeURIComponent(organizationId),{credentials:"include",signal:controller.signal})
      .then(async r=>{const data=await r.json();if(!r.ok)throw new Error(data.error??"Billing status unavailable");setBillingState(data as BillingState);})
      .catch((err:unknown)=>{if(!controller.signal.aborted)setBillingError(err instanceof Error?err.message:"Billing unavailable");});
    return ()=>controller.abort();
  },[organizationId]);
  const openBilling = async (path:"checkout"|"portal") => {
    setBillingBusy(true);setBillingError("");
    try {
      const body=path==="checkout"?{organizationId,interval,mailboxes,aiSeats:aiMailboxes}:{organizationId};
      const response=await fetch("/admin/billing/"+path,{method:"POST",credentials:"include",
        headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
      const result=await response.json() as {url?:string;error?:string};
      if(!response.ok||!result.url)throw new Error(result.error??"Unable to open Stripe");
      if(!result.url.startsWith("https://checkout.stripe.com/")&&!result.url.startsWith("https://billing.stripe.com/"))throw new Error("Invalid Stripe redirect");
      window.location.assign(result.url);
    }catch(e){setBillingError(e instanceof Error?e.message:"Billing unavailable");setBillingBusy(false);}
  };
  const [mailboxes, setMailboxes] = useState(Math.max(1, currentMailboxes));
  const [aiMailboxes, setAiMailboxes] = useState(0);
  useEffect(() => { setMailboxes(value => Math.max(value, currentMailboxes, 1)); }, [currentMailboxes]);
  const operatorExempt = billingState?.operatorExempt ?? billingState?.legacyFreeForLife ?? false;
  const freeMailboxes = operatorExempt ? mailboxes : Math.min(mailboxes, billingState?.includedFreeMailboxes ?? 1);
  const paidMailboxes = Math.max(0, mailboxes - freeMailboxes);
  const total = paidMailboxes * PRICES[interval].mailbox + aiMailboxes * PRICES[interval].ai;
  const period = interval === "month" ? "month" : "year";

  return <div style={{ maxWidth: 930, margin: "0 auto", paddingBottom: 36 }}>
    <div style={{ marginBottom: 25 }}>
      <p className="gsw-setup-kicker">Your first mailbox is free for life</p>
      <h2 style={{ margin: "6px 0 9px" }}>Your mail, your way.</h2>
      <p style={{ opacity: .78, lineHeight: 1.6 }}>Every workspace includes one lifetime-free mailbox with 5 GB email storage. Additional mailboxes cost $15/year each when billed annually. Domain management is free, and hosted AI is optional.</p>
    </div>
    <div style={{ display: "flex", gap: 6, padding: 5, borderRadius: 999, background: "var(--gsw-surface-muted, rgba(127,127,127,.10))", width: "fit-content", marginBottom: 20 }}>
      {(["month", "year"] as const).map(value => <button key={value} type="button" aria-pressed={interval === value} onClick={() => setInterval(value)} style={{ border: "none", cursor: "pointer", padding: "10px 19px", borderRadius: 999, fontWeight: 650, color: interval === value ? "#fff" : "inherit", background: interval === value ? "#206d5b" : "transparent" }}>{value === "month" ? "Monthly" : "Annually"}</button>)}
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(245px, 1fr))", gap: 14, marginBottom: 24 }}>
      <article style={{ border: "1px solid var(--gsw-border, #d8dcd8)", borderRadius: 20, padding: 23 }}>
        <p className="gsw-setup-kicker">Additional GSW Mail mailboxes</p>
        <h3 style={{ margin: "12px 0 4px", fontSize: 30 }}>{dollars(PRICES[interval].mailbox)}<small style={{ fontSize: 14, fontWeight: 450 }}>/mailbox/{period}</small></h3>
        <p style={{ opacity: .74, marginBottom: 16 }}>Your first mailbox is free for life. This price applies only to each additional mailbox.</p>
        <div style={{ lineHeight: 2 }}>✓ Email, calendar and contacts<br/>✓ 5 GB email storage per mailbox<br/>✓ Files and productivity tools<br/>✓ API access with fair usage limits<br/>✓ Plugins for ChatGPT, Claude and other AI providers</div>
      </article>
      <article style={{ border: "1px solid #81a99c", borderRadius: 20, padding: 23, background: "rgba(52,137,109,.055)" }}>
        <p className="gsw-setup-kicker">Optional AI</p>
        <h3 style={{ margin: "12px 0 4px", fontSize: 30 }}>{dollars(PRICES[interval].ai)}<small style={{ fontSize: 14, fontWeight: 450 }}>/AI mailbox/{period}</small></h3>
        <p style={{ opacity: .74, marginBottom: 16 }}>Add intelligence to selected mailboxes.</p>
        <div style={{ lineHeight: 2 }}>✓ Built-in AI Chat<br/>✓ AI Scheduled Work<br/>✓ GSW-hosted AI tools<br/>✓ Admin-controlled AI access<br/>✓ All your existing mail features</div>
      </article>
    </div>
    <section style={{ border: "1px solid var(--gsw-border, #d8dcd8)", borderRadius: 22, padding: 24 }}>
      <h3 style={{ marginTop: 0 }}>See how your subscription scales</h3>
      <p style={{ opacity: .75, marginBottom: 23 }}>Adjust the number of mailboxes and choose how many should have AI.</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 20 }}>
        <label style={{ display: "grid", gap: 10 }}>Mailboxes <strong style={{ fontSize: 26 }}>{mailboxes}</strong><input type="range" min={Math.max(1, currentMailboxes)} max={Math.max(50, currentMailboxes)} value={mailboxes} onChange={event => { const next = Number(event.target.value); setMailboxes(next); setAiMailboxes(value => Math.min(value, next)); }} /><small>One mailbox is free for life; each includes 5 GB storage</small></label>
        <label style={{ display: "grid", gap: 10 }}>Mailboxes with AI <strong style={{ fontSize: 26 }}>{aiMailboxes}</strong><input type="range" min={0} max={mailboxes} value={aiMailboxes} onChange={event => setAiMailboxes(Number(event.target.value))} /><small>Choose AI only for the mailboxes that need it</small></label>
      </div>
      <div style={{ marginTop: 26, borderTop: "1px solid var(--gsw-border, #d8dcd8)", paddingTop: 20, display: "grid", gap: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}><span>{freeMailboxes} × Included free {freeMailboxes === 1 ? "mailbox" : "mailboxes"}</span><strong>{dollars(0)}</strong></div>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}><span>{paidMailboxes} × Additional mailboxes</span><strong>{dollars(paidMailboxes * PRICES[interval].mailbox)}</strong></div>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}><span>{aiMailboxes} × AI add-ons</span><strong>{dollars(aiMailboxes * PRICES[interval].ai)}</strong></div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, paddingTop: 8 }}><strong>Estimated total / {period}</strong><strong style={{ fontSize: 32, color: "#258b71" }}>{dollars(total)}</strong></div>
      </div>
      {billingState?.legacyFreeForLife && <p style={{padding:14,border:"1px solid #7fae95",borderRadius:12,marginTop:18}}><strong>Operator exception.</strong> This workspace has unlimited Core mailboxes at no charge. Optional hosted AI is billed separately.</p>}
      {billingState?.subscription && <div style={{padding:14,border:"1px solid var(--gsw-border,#d8dcd8)",borderRadius:12,marginTop:18}}>
        <strong>Current subscription: {billingState.subscription.status}</strong><p style={{fontSize:13}}>
          {billingState.subscription.mailboxes ?? 0} mailbox licenses · {billingState.subscription.aiSeats ?? 0} AI licenses
          {billingState.subscription.currentPeriodEnd ? " · Period ends "+new Date(billingState.subscription.currentPeriodEnd).toLocaleDateString(): ""}</p>
      </div>}
      {billingError && <p role="alert" style={{color:"#ab3838"}}>{billingError}</p>}
      {billingState && !operatorExempt && <div style={{marginTop:16}}>
        {billingState.subscription ? <button type="button" className="gsw-btn gsw-btn-primary" disabled={!billingState.checkoutEnabled||billingBusy} onClick={()=>void openBilling("portal")}>Manage subscription & invoices</button>
        : <button type="button" className="gsw-btn gsw-btn-primary" disabled={!billingState.checkoutEnabled||billingBusy||(paidMailboxes===0&&aiMailboxes===0)} onClick={()=>void openBilling("checkout")}>{paidMailboxes===0&&aiMailboxes===0 ? "Your first mailbox is free" : "Subscribe with Stripe"}</button>}
      </div>}
      <p style={{ fontSize: 12, opacity: .7, marginTop: 15 }}>{billingState?.checkoutEnabled ? "Final price and applicable taxes are confirmed in Stripe Checkout." : "Price preview only. Stripe checkout is not enabled yet; your data and existing mail remain accessible."}</p>
    </section>
  </div>;
}
