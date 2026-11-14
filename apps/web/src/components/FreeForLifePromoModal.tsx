import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Gift, HeartHandshake, RotateCcw, X } from "lucide-react";

type BillingPeriod = "monthly" | "annual";

const comparisons = [
  {
    name: "GSW Mail",
    subtitle: "For pastors, churches and ministry teams",
    monthly: "First free; +$2.50/mo",
    annual: "First free; +$15/yr",
    storage: "5 GB email storage per mailbox",
    tools: "Custom email, calendar, contacts, files, branded templates, scheduled mail, API + AI plugins",
    ai: "Optional AI Chat + scheduled agents ($25/mo or $125/yr)",
    community: "Bible Study App community, live streaming and upcoming integrated ministry campaigns",
    url: "/control-center#billing",
    recommended: true,
  },
  {
    name: "Google Workspace",
    subtitle: "Business Starter",
    monthly: "$8.40",
    annual: "$84/yr",
    storage: "30 GB pooled per user",
    tools: "Gmail, Calendar, Drive, Docs",
    ai: "Gemini in Gmail (plan features vary)",
    community: "Independent Google ecosystem",
    url: "https://workspace.google.com/pricing",
  },
  {
    name: "Zoho Workplace",
    subtitle: "Standard",
    monthly: "$4.00",
    annual: "$36/yr",
    storage: "30 GB mail + team files",
    tools: "Mail, Calendar, WorkDrive, Writer",
    ai: "Zia assistant (features vary)",
    community: "Independent Zoho ecosystem",
    url: "https://www.zoho.com/workplace/pricing.html",
  },
  {
    name: "Zoho Mail Lite",
    subtitle: "Email-focused, 5 GB",
    monthly: "Annual only",
    annual: "$12/yr",
    storage: "5 GB mail",
    tools: "Custom-domain webmail and mail tools",
    ai: "No comparable hosted AI bundle",
    community: "Independent Zoho ecosystem",
    url: "https://www.zoho.com/mail/zohomail-pricing.html",
  },
  {
    name: "Microsoft 365",
    subtitle: "Business Basic",
    monthly: "$8.40",
    annual: "$84/yr",
    storage: "50 GB mailbox + 1 TB OneDrive",
    tools: "Outlook, Calendar, OneDrive, Office web",
    ai: "Copilot Chat (web-grounded)",
    community: "Independent Microsoft ecosystem",
    url: "https://www.microsoft.com/en-us/microsoft-365/business/microsoft-365-business-basic",
  },
] as const;

const moneyNote = {
  monthly: "First GSW mailbox is free for life. Additional mailboxes can use monthly billing where offered.",
  annual: "Your first GSW Mail mailbox is free for life; each additional mailbox costs $15/year paid upfront. Other providers may bill monthly on an annual commitment."
} as const;

export function FreeForLifePromoModal({ onDismiss }: { onDismiss: () => void }) {
  const [flipped, setFlipped] = useState(false);
  const [period, setPeriod] = useState<BillingPeriod>("annual");
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => { document.body.style.overflow = oldOverflow; };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onDismiss();
        return;
      }
      if (event.key !== "Tab") return;
      const dialog = document.querySelector<HTMLElement>(".lp2-offer-dialog");
      if (!dialog) return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>("a[href],button:not([disabled]),[tabindex]:not([tabindex='-1'])")]
        .filter((element) => element.getAttribute("aria-hidden") !== "true" && !element.closest("[inert]"));
      if (!focusable.length) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onDismiss, flipped]);

  return <div className="lp2-free-backdrop" role="presentation" onMouseDown={(event) => {
    if (event.target === event.currentTarget) onDismiss();
  }}>
    <section className={`lp2-offer-dialog ${flipped ? "is-flipped" : ""}`} role="dialog" aria-modal="true"
      aria-label={flipped ? "GSW Mail subscription pricing comparison" : "One free mailbox for life"}>
      <button className="lp2-free-close" ref={closeRef} type="button" aria-label="Close offer" onClick={onDismiss}><X size={21} /></button>
      <div className="lp2-offer-stage">
        <div className="lp2-offer-rotator">
          <div className="lp2-offer-face lp2-offer-front" aria-hidden={flipped}>
            <span className="lp2-free-kicker"><Gift size={16}/> For every new ministry or organization</span>
            <h2>Your first mailbox.<br/><em>Free for life.</em></h2>
            <p>Start with <strong>one mailbox free for life</strong>. When your church or ministry grows, add more mailboxes for <strong>$15 per year each</strong> with annual billing.</p>
            <div className="lp2-free-benefits">
              <span><Check size={17}/> Custom-domain email and calendars</span>
              <span><Check size={17}/> Contacts, files and scheduled sending</span>
              <span><Check size={17}/> AI plugins for ChatGPT, Claude and more</span>
            </div>
            <div className="lp2-offer-community"><HeartHandshake size={24}/>
              <div><strong>More than an inbox.</strong><span>Be part of Guided Steps Wellness: The Community—a growing ecosystem connecting people, ministries, businesses and opportunities to serve.</span></div>
            </div>
            <a className="lp2-button lp2-free-cta" href="/sign-up" onClick={onDismiss}>Start my free mailbox <ArrowRight size={17}/></a>
            <button type="button" className="lp2-offer-flip-trigger" onClick={() => setFlipped(true)}>
              See our mailbox pricing <ArrowRight size={17}/>
            </button>
            <small className="lp2-offer-expiry">No signup deadline for your first free mailbox. Additional mailboxes and optional hosted AI are paid services.</small>
          </div>
          <div className="lp2-offer-face lp2-offer-back" aria-hidden={!flipped}>
            <div className="lp2-offer-back-head">
              <span className="lp2-free-kicker">The value beyond the inbox</span>
              <h2>Less for mail.<br/><em>More for your mission.</em></h2>
              <p>Compare the complete workspace, not just the inbox.</p>
              <div className="lp2-offer-period" aria-label="Compare subscription billing periods">
                <button className={period === "annual" ? "active" : ""} type="button" aria-pressed={period === "annual"} onClick={() => setPeriod("annual")}>Annual</button>
                <button className={period === "monthly" ? "active" : ""} type="button" aria-pressed={period === "monthly"} onClick={() => setPeriod("monthly")}>Monthly</button>
              </div>
            </div>
            <div className="lp2-offer-table-scroll" role="region" tabIndex={0} aria-label="Compare email service pricing and features">
              <table className="lp2-offer-table">
                <caption className="lp2-sr-only">Public list prices for custom domain email plans in US dollars as of November 2026</caption>
                <thead><tr><th scope="col">Provider</th>{comparisons.map((plan) =>
                  <th key={plan.name} scope="col" className={plan.name === "GSW Mail" ? "gsw-plan" : ""}>
                    {plan.name === "GSW Mail" && <span className="lp2-gsw-featured-tag"><Check size={12}/> YOUR COMMUNITY WORKSPACE</span>}
                    <a href={plan.url} target={plan.url.startsWith("https") ? "_blank" : undefined} rel={plan.url.startsWith("https") ? "noopener noreferrer" : undefined}>{plan.name}</a>
                    <small>{plan.subtitle}</small>
                    {plan.name === "GSW Mail" && <span className="lp2-gsw-featured-storage">5 GB email storage / mailbox</span>}
                  </th>)}</tr></thead>
                <tbody>
                  <tr className="lp2-offer-price-row"><th scope="row">Price per additional mailbox / user</th>{comparisons.map((p) =>
                    <td key={p.name} className={p.name === "GSW Mail" ? "gsw-plan" : ""}><strong>{p[period]}</strong><small>{period === "annual" && p.name !== "GSW Mail" ? "annual commitment" : period === "annual" ? "per additional mailbox · paid upfront" : "per additional mailbox / month"}</small></td>)}</tr>
                  <tr><th scope="row">Email storage</th>{comparisons.map(p=><td key={p.name} className={p.name === "GSW Mail" ? "gsw-plan" : ""}>{p.storage}</td>)}</tr>
                  <tr><th scope="row">Included tools</th>{comparisons.map(p=><td key={p.name} className={p.name === "GSW Mail" ? "gsw-plan" : ""}>{p.tools}</td>)}</tr>
                  <tr><th scope="row">Built-in AI</th>{comparisons.map(p=><td key={p.name} className={p.name === "GSW Mail" ? "gsw-plan" : ""}>{p.ai}</td>)}</tr>
                  <tr><th scope="row">Ecosystem</th>{comparisons.map(p=><td key={p.name} className={p.name === "GSW Mail" ? "gsw-plan" : ""}>{p.community}</td>)}</tr>
                </tbody>
              </table>
            </div>
            <p className="lp2-offer-note">{moneyNote[period]} USD before tax, excluding promotions. Plans are not identical; storage, app functionality and AI allowances differ. Zoho Mail Lite is an email-only option, while Zoho Workplace Standard includes more office tools. <a href="https://workspace.google.com/pricing" target="_blank" rel="noopener noreferrer">Google</a> · <a href="https://www.zoho.com/workplace/pricing.html" target="_blank" rel="noopener noreferrer">Zoho</a> · <a href="https://www.microsoft.com/en-us/microsoft-365/business/microsoft-365-business-basic" target="_blank" rel="noopener noreferrer">Microsoft</a></p>
            <div className="lp2-offer-outlook"><HeartHandshake size={25}/><div><strong>One inbox. A connected ecosystem.</strong><p>Custom-domain inboxes, calendar, contacts, files, branded templates, scheduled mail, API access, and AI plugins for ChatGPT or Claude are included. Hosted AI Chat and agentic scheduled work are optional. Coming next: bookable meeting links with Zoom, Teams, Google Meet or Zoho Cliq; Bible Study App rooms, livestreams and social broadcasting. These are in development.</p><p>Built for small teams, ministry leaders and founders—and connected to Guided Steps Wellness: The Community.</p></div></div>
            <div className="lp2-offer-actions"><button type="button" className="lp2-offer-back-button" onClick={() => setFlipped(false)}><ArrowLeft size={17}/> Back to free offer <RotateCcw size={14}/></button><a href="/sign-up" className="lp2-button lp2-free-cta" onClick={onDismiss}>Start with a free mailbox <ArrowRight size={17}/></a></div>
          </div>
        </div>
      </div>
    </section>
  </div>;
}
