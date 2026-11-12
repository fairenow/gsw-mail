import { useEffect, useState } from "react";

type Interval = "month" | "year";
const PRICES = {
  month: { mailbox: 250, ai: 2500 },
  year: { mailbox: 1500, ai: 12500 },
} as const;
const dollars = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);

export function AdminBillingPanel({ currentMailboxes }: { currentMailboxes: number }) {
  const [interval, setInterval] = useState<Interval>("month");
  const [mailboxes, setMailboxes] = useState(Math.max(1, currentMailboxes));
  const [aiMailboxes, setAiMailboxes] = useState(0);
  useEffect(() => { setMailboxes(value => Math.max(value, currentMailboxes, 1)); }, [currentMailboxes]);
  const total = mailboxes * PRICES[interval].mailbox + aiMailboxes * PRICES[interval].ai;
  const period = interval === "month" ? "month" : "year";

  return <div style={{ maxWidth: 930, margin: "0 auto", paddingBottom: 36 }}>
    <div style={{ marginBottom: 25 }}>
      <p className="gsw-setup-kicker">Simple, predictable pricing</p>
      <h2 style={{ margin: "6px 0 9px" }}>Your mail, your way.</h2>
      <p style={{ opacity: .78, lineHeight: 1.6 }}>Every mailbox includes the tools you need. Add AI only where you want it. Domain management and your admin account are always free.</p>
    </div>
    <div style={{ display: "flex", gap: 6, padding: 5, borderRadius: 999, background: "var(--gsw-surface-muted, rgba(127,127,127,.10))", width: "fit-content", marginBottom: 20 }}>
      {(["month", "year"] as const).map(value => <button key={value} type="button" aria-pressed={interval === value} onClick={() => setInterval(value)} style={{ border: "none", cursor: "pointer", padding: "10px 19px", borderRadius: 999, fontWeight: 650, color: interval === value ? "#fff" : "inherit", background: interval === value ? "#206d5b" : "transparent" }}>{value === "month" ? "Monthly" : "Annually"}</button>)}
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(245px, 1fr))", gap: 14, marginBottom: 24 }}>
      <article style={{ border: "1px solid var(--gsw-border, #d8dcd8)", borderRadius: 20, padding: 23 }}>
        <p className="gsw-setup-kicker">GSW Mail</p>
        <h3 style={{ margin: "12px 0 4px", fontSize: 30 }}>{dollars(PRICES[interval].mailbox)}<small style={{ fontSize: 14, fontWeight: 450 }}>/mailbox/{period}</small></h3>
        <p style={{ opacity: .74, marginBottom: 16 }}>Everything you need in one mailbox.</p>
        <div style={{ lineHeight: 2 }}>✓ Email, calendar and contacts<br/>✓ 1 GB storage per mailbox<br/>✓ Files and productivity tools<br/>✓ API access with fair usage limits<br/>✓ MCP with compatible AI providers</div>
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
        <label style={{ display: "grid", gap: 10 }}>Mailboxes <strong style={{ fontSize: 26 }}>{mailboxes}</strong><input type="range" min={Math.max(1, currentMailboxes)} max={Math.max(50, currentMailboxes)} value={mailboxes} onChange={event => { const next = Number(event.target.value); setMailboxes(next); setAiMailboxes(value => Math.min(value, next)); }} /><small>Each mailbox gets 1 GB storage</small></label>
        <label style={{ display: "grid", gap: 10 }}>Mailboxes with AI <strong style={{ fontSize: 26 }}>{aiMailboxes}</strong><input type="range" min={0} max={mailboxes} value={aiMailboxes} onChange={event => setAiMailboxes(Number(event.target.value))} /><small>Choose AI only for the mailboxes that need it</small></label>
      </div>
      <div style={{ marginTop: 26, borderTop: "1px solid var(--gsw-border, #d8dcd8)", paddingTop: 20, display: "grid", gap: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}><span>{mailboxes} × Mailboxes</span><strong>{dollars(mailboxes * PRICES[interval].mailbox)}</strong></div>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}><span>{aiMailboxes} × AI add-ons</span><strong>{dollars(aiMailboxes * PRICES[interval].ai)}</strong></div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, paddingTop: 8 }}><strong>Estimated total / {period}</strong><strong style={{ fontSize: 32, color: "#258b71" }}>{dollars(total)}</strong></div>
      </div>
      <p style={{ fontSize: 12, opacity: .7, marginTop: 15 }}>Price preview only. Subscription checkout is not yet enabled. Taxes, if applicable, are not included.</p>
    </section>
  </div>;
}
