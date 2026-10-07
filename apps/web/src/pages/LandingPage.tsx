import {
  ArrowRight,
  Bot,
  CalendarDays,
  Check,
  Clock3,
  Inbox,
  Layers3,
  Mail,
  RefreshCw,
  Send,
  ShieldCheck,
  Smartphone,
  Sparkles,
  UsersRound,
} from "lucide-react";
import { BrandMark } from "../components/auth/BrandMark";
import "../styles/landing-v2.css";

const capabilityItems = [
  ["Switch identities", "Move between accounts without moving between apps.", Layers3],
  ["Send once. Or keep sending.", "Schedule a message once or put recurring communication on a rhythm.", RefreshCw],
  ["Turn mail into meetings", "Keep conversations and time in the same workflow.", CalendarDays],
  ["Ask your inbox to act", "Connect intelligent tools without turning your inbox into a chatbot.", Sparkles],
] as const;

const featureCards = [
  ["01", "Move through mail", "A focused inbox with the controls you expect and less visual noise.", Inbox],
  ["02", "Keep writing", "Start a message, move through your inbox, and keep the composer with you.", Mail],
  ["03", "Send on your time", "Send later, recur automatically, and manage active messages from Outbox.", Clock3],
  ["04", "Turn email into time", "Create meetings and keep reminders close to the conversation that created them.", CalendarDays],
  ["05", "Switch identities", "Personal, business, and team email without another pile of browser tabs.", UsersRound],
  ["06", "Connect tools", "Bring AI and future services into the workflow without handing over everything by default.", Bot],
] as const;

const workflows = [
  ["Founders", "Move between identities, schedule outreach, and keep meetings tied to the conversations that created them."],
  ["Outreach", "Prepare communication in advance and let it leave when recipients are most likely to see it."],
  ["Teams", "Take recurring updates and follow-ups off the manual admin list."],
  ["Everyday email", "Keep messages, calendars, reminders, contacts, and the accounts you use every day in one place."],
] as const;

function ProductMockup() {
  return <div className="lp2-product-shell" aria-label="GSW Mail product preview">
    <div className="lp2-product-topbar">
      <BrandMark size={26} />
      <div className="lp2-search">Search mail, people, and events</div>
      <div className="lp2-avatar">RW</div>
    </div>
    <div className="lp2-product-body">
      <aside className="lp2-sidebar">
        <button><Mail size={17} /> Compose</button>
        <span className="active"><Inbox size={17} /> Inbox <b>8</b></span>
        <span><Clock3 size={17} /> Outbox <b>3</b></span>
        <span><CalendarDays size={17} /> Calendar</span>
        <span><UsersRound size={17} /> Contacts</span>
      </aside>
      <section className="lp2-inbox">
        <header><div><small>Inbox</small><strong>Good evening, Ramon.</strong></div><button>Focus</button></header>
        {[
          ["DC","Danielle Carter","Re: Partnership follow-up","Thanks Ramon. Tuesday works well for me.","2:18 PM",true],
          ["JT","Jordan Thomas","Coffee next week?","Thursday morning is perfect.","11:42 AM",false],
          ["PT","Project Team","Launch checklist","The final review is ready.","9:06 AM",false],
        ].map(([initials,name,subject,copy,time,selected]) => <div className={`lp2-message ${selected ? "selected" : ""}`} key={String(subject)}>
          <i>{initials}</i><div><strong>{name}</strong><b>{subject}</b><span>{copy}</span></div><time>{time}</time>
        </div>)}
      </section>
      <section className="lp2-compose">
        <div className="lp2-compose-card">
          <div className="lp2-compose-head"><strong>New message</strong><span>Saved</span></div>
          <label><span>To</span><b>danielle@example.org</b></label>
          <label><span>Subject</span><b>Following up on our conversation</b></label>
          <p>Hi Danielle,<br/><br/>Thanks again for taking the time to connect. I wanted to follow up with the next steps we discussed.</p>
          <footer><button><Send size={15}/> Send</button><button className="secondary"><Clock3 size={15}/> Schedule</button></footer>
        </div>
        <div className="lp2-floating-status"><Check size={16}/><span><b>Moved to Outbox</b> Tomorrow · 8:00 AM</span></div>
      </section>
    </div>
  </div>;
}

function OutboxFlow() {
  return <div className="lp2-flow">
    <div><small>Drafts</small><strong>Still being written</strong></div>
    <ArrowRight />
    <div className="active"><small>Outbox</small><strong>Still yours</strong><span>Edit · Move · Pause · Cancel</span></div>
    <ArrowRight />
    <div><small>Sent</small><strong>Delivered</strong></div>
  </div>;
}

export function LandingPage() {
  return <main className="lp2">
    <nav className="lp2-nav">
      <a className="lp2-brand" href="/"><BrandMark size={34}/><span>GSW Mail</span></a>
      <div className="lp2-nav-links"><a href="#features">Features</a><a href="#workflows">Workflows</a><a href="#ownership">Built differently</a><a href="#faq">FAQ</a></div>
      <div className="lp2-nav-actions"><a href="/sign-in">Sign in</a><a className="lp2-button small" href="/sign-up">Start free</a></div>
    </nav>

    <section className="lp2-hero">
      <div className="lp2-hero-copy">
        <span className="lp2-eyebrow">Your domain · Your workflow · Your inbox</span>
        <h1>Email, on your terms.</h1>
        <p>One inbox for sending, scheduling, recurring messages, calendars, multiple identities, and intelligent tools.</p>
        <div className="lp2-actions"><a className="lp2-button" href="/sign-up">Start free <ArrowRight size={17}/></a><a className="lp2-text-link" href="#product">See it work</a></div>
        <div className="lp2-hero-note"><Clock3 size={17}/><span>Write → Schedule → Outbox → Send</span></div>
      </div>
      <div id="product" className="lp2-hero-product"><ProductMockup/></div>
    </section>

    <section className="lp2-proof">
      <div><span>One inbox.</span><span>Every identity.</span><span>Work that keeps moving.</span></div>
      <div className="lp2-proof-grid">{capabilityItems.map(([title,copy,Icon]) => <article key={title}><Icon size={22}/><strong>{title}</strong><p>{copy}</p></article>)}</div>
    </section>

    <section id="features" className="lp2-section">
      <div className="lp2-section-heading"><span className="lp2-eyebrow">Everything around the email</span><h2>Email is the message. The work keeps going.</h2><p>GSW Mail keeps the pieces around email close enough that you can act without constantly switching context.</p></div>
      <div className="lp2-feature-grid">{featureCards.map(([num,title,copy,Icon]) => <article key={title}><span>{num}</span><Icon size={24}/><h3>{title}</h3><p>{copy}</p></article>)}</div>
    </section>

    <section className="lp2-schedule-section">
      <div className="lp2-schedule-copy"><span className="lp2-eyebrow">Schedule</span><h2>Now. Later. Repeated.</h2><p>Follow-ups, reminders, reports, outreach, and recurring communication should not depend on you remembering to hit Send.</p><ul><li><Check/>Send when the timing is right</li><li><Check/>Repeat communication automatically</li><li><Check/>Change it before it leaves</li></ul></div>
      <div className="lp2-schedule-demo">
        <div className="lp2-send-card"><header><strong>Weekly project update</strong><span>Outbox</span></header><p>Here’s the latest progress and what we’re focused on next week.</p><div><button>Now</button><button className="active">Later</button><button>Repeated</button></div><footer><Clock3 size={16}/><span>Every Friday · 8:00 AM</span></footer></div>
      </div>
    </section>

    <section className="lp2-outbox">
      <div className="lp2-section-heading compact"><span className="lp2-eyebrow">Outbox</span><h2>Until it sends, it’s still yours.</h2><p>Scheduled and recurring messages stay active until they are actually delivered. Open them. Edit them. Move them. Pause them. Cancel them.</p></div>
      <OutboxFlow/>
    </section>

    <section id="workflows" className="lp2-workflows">
      <div className="lp2-section-heading"><span className="lp2-eyebrow">Workflows</span><h2>Use email for the work around the message.</h2></div>
      <div className="lp2-workflow-grid">{workflows.map(([title,copy],index)=><article key={title}><span>0{index+1}</span><h3>{title}</h3><p>{copy}</p><ArrowRight size={19}/></article>)}</div>
    </section>

    <section className="lp2-ai">
      <div className="lp2-ai-copy"><span className="lp2-eyebrow">Connect tools</span><h2>Ask. Act. Done.</h2><p>Your inbox should not just contain work. Intelligent tools can help find the conversation, prepare the follow-up, create the event, and keep the context together.</p><div className="lp2-ai-tags"><span>Find the thread</span><span>Draft the reply</span><span>Create the event</span><span>Keep the context</span></div></div>
      <div className="lp2-ai-card"><div className="lp2-ai-message user">Find the conversations I owe a follow-up to this week.</div><div className="lp2-ai-message assistant"><Sparkles size={18}/><div><strong>I found 4 conversations.</strong><span>Danielle Carter · partnership follow-up</span><span>Jordan Thomas · scheduling</span><span>Project Team · launch review</span><button>Draft follow-ups</button></div></div></div>
    </section>

    <section id="ownership" className="lp2-ownership">
      <div><span className="lp2-eyebrow">Ownership</span><h2>Own your email.</h2></div>
      <div><p>Your domain. Your mailbox. Modern standards underneath. GSW Mail is not simply a new skin on Gmail or Outlook. It is built around independently operated infrastructure so the product can evolve around your identity, workflows, integrations, and portability.</p><div className="lp2-standards"><span><ShieldCheck/>Custom-domain identity</span><span><RefreshCw/>Modern sync + standards</span><span><Layers3/>Portable infrastructure</span></div></div>
    </section>

    <section className="lp2-platforms">
      <div className="lp2-section-heading compact"><span className="lp2-eyebrow">Everywhere</span><h2>Web. Mobile. Yours.</h2></div>
      <div className="lp2-platform-grid"><article><Mail/><h3>Web</h3><p>The full GSW Mail workspace for focused, high-context work.</p></article><article><Smartphone/><h3>Mobile</h3><p>Mail, scheduling, accounts, and calendar aligned with the web experience.</p></article><article><ShieldCheck/><h3>Your domain</h3><p>A professional identity that belongs to you, not a consumer mailbox provider.</p></article></div>
    </section>

    <section id="faq" className="lp2-faq">
      <div className="lp2-section-heading compact"><span className="lp2-eyebrow">FAQ</span><h2>A few things worth knowing.</h2></div>
      <div className="lp2-faq-grid">
        <article><h3>Is GSW Mail just another Gmail client?</h3><p>No. GSW Mail is built around its own independently operated mail stack and product workflows rather than simply wrapping a consumer inbox.</p></article>
        <article><h3>Can I use my own domain?</h3><p>Yes. Custom-domain identity is a core part of how GSW Mail is designed.</p></article>
        <article><h3>What makes Outbox different?</h3><p>Outbox is where scheduled and recurring messages stay active before delivery, so you can still manage them.</p></article>
        <article><h3>Does AI get access to my mailbox?</h3><p>Connections are designed to be explicit and permissioned. Identity access and mailbox access are separate concepts rather than one blanket permission.</p></article>
      </div>
    </section>

    <section className="lp2-final">
      <span className="lp2-eyebrow">Ready when you are</span>
      <h2>Email can be better.</h2>
      <p>A faster, calmer, more capable inbox built around communication that keeps moving after you hit compose.</p>
      <a className="lp2-button" href="/sign-up">Start free <ArrowRight size={17}/></a>
    </section>

    <footer className="lp2-footer"><a className="lp2-brand" href="/"><BrandMark size={28}/><span>GSW Mail</span></a><div><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/sign-in">Sign in</a></div><span>Guided Steps Wellness: The Community · Est. 2025</span></footer>
  </main>;
}
