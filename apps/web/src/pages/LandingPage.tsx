import { useEffect, useRef, useState } from "react";
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
  UsersRound,
} from "lucide-react";
import { BrandMark } from "../components/auth/BrandMark";
import { FreeForLifePromoModal } from "../components/FreeForLifePromoModal";
import "../styles/landing-v2.css";

// Registration closes for lifetime-free eligibility at midnight EST on Nov 21.
const FREE_FOR_LIFE_CUTOFF_MS = Date.parse("2026-11-21T05:00:00.000Z");
const FREE_ACCOUNT_PROMO_SESSION_KEY = "gsw-mail-lifetime-free-promo-2026";
const freeOfferOpen = () => Date.now() < FREE_FOR_LIFE_CUTOFF_MS;

const capabilityItems = [
  ["One place for ministry email", "Move between church, ministry, and personal accounts without changing apps.", Layers3],
  ["Stay consistent in communication", "Schedule announcements, reminders, and recurring updates ahead of time.", RefreshCw],
  ["Make room for people", "Keep ministry conversations, meetings, and calendars connected.", CalendarDays],
  ["Get help with the details", "Use permissioned tools to assist with follow-ups and administration.", Bot],
] as const;

const featureCards = [
  ["01", "Stay focused on people", "A clear inbox for the conversations, questions, and requests that matter.", Inbox],
  ["02", "Keep the conversation going", "Write to members, volunteers, and ministry partners without losing your place.", Mail],
  ["03", "Plan ministry communication", "Schedule announcements and recurring reminders, then manage them in Outbox.", Clock3],
  ["04", "Coordinate meetings", "Keep leadership meetings, pastoral conversations, and calendar reminders connected.", CalendarDays],
  ["05", "Serve across ministries", "Manage church, outreach, and individual email identities from one workspace.", UsersRound],
  ["06", "Make administration lighter", "Connect helpful AI tools with explicit permissions and room to grow.", Bot],
] as const;

const workflows = [
  ["Pastors & ministry leaders", "Make time for shepherding people by organizing correspondence, follow-ups, and meetings."],
  ["Outreach ministries", "Prepare community updates, volunteer coordination, and outreach follow-ups ahead of time."],
  ["Church administrators", "Keep staff, ministry teams, and recurring announcements organized without constant manual sending."],
  ["Christian organizations", "Keep partners, donors, contacts, and the work around your messages in one place."],
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
        <header><div><small>Inbox</small><strong>Good morning, Pastor.</strong></div><button>Focus</button></header>
        {[
          ["DC","Danielle Carter","Volunteer team follow-up","Thanks, Pastor. Tuesday works well for us.","2:18 PM",true],
          ["JT","Jordan Thomas","Leadership meeting","Thursday morning works for our team.","11:42 AM",false],
          ["MT","Ministry Team","Sunday service details","The volunteer schedule is ready.","9:06 AM",false],
        ].map(([initials,name,subject,copy,time,selected]) => <div className={`lp2-message ${selected ? "selected" : ""}`} key={String(subject)}>
          <i>{initials}</i><div><strong>{name}</strong><b>{subject}</b><span>{copy}</span></div><time>{time}</time>
        </div>)}
      </section>
      <section className="lp2-compose">
        <div className="lp2-compose-card">
          <div className="lp2-compose-head"><strong>New message</strong><span>Saved</span></div>
          <label><span>To</span><b>danielle@example.org</b></label>
          <label><span>Subject</span><b>Following up on volunteer coordination</b></label>
          <p>Hi Danielle,<br/><br/>Thank you for helping coordinate our volunteers. Here are the next steps for Sunday.</p>
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
  const pageRef = useRef<HTMLElement>(null);
  const [showFreeAccountModal, setShowFreeAccountModal] = useState(false);
  useEffect(() => {
    if (!freeOfferOpen()) return;
    try {
      if (sessionStorage.getItem(FREE_ACCOUNT_PROMO_SESSION_KEY) === "dismissed") return;
    } catch { /* Private browsing can disable session storage. */ }
    const timer = window.setTimeout(() => {
      if (freeOfferOpen()) setShowFreeAccountModal(true);
    }, 7_000);
    return () => window.clearTimeout(timer);
  }, []);

  const dismissFreeAccountModal = () => {
    setShowFreeAccountModal(false);
    try { sessionStorage.setItem(FREE_ACCOUNT_PROMO_SESSION_KEY, "dismissed"); } catch { /* Storage is optional. */ }
  };

  useEffect(() => {
    const root = pageRef.current;
    if (!root) return;
    const items = Array.from(root.querySelectorAll<HTMLElement>("[data-reveal]"));
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      items.forEach((item) => item.classList.add("is-visible"));
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        (entry.target as HTMLElement).classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.14, rootMargin: "0px 0px -8% 0px" });
    items.forEach((item) => observer.observe(item));
    return () => observer.disconnect();
  }, []);

  return <main ref={pageRef} className="lp2">
    {showFreeAccountModal && freeOfferOpen() && <FreeForLifePromoModal onDismiss={dismissFreeAccountModal} />}
    <nav className="lp2-nav">
      <a className="lp2-brand" href="/"><BrandMark size={34}/><span>GSW Mail</span></a>
      <div className="lp2-nav-links"><a href="#features">Features</a><a href="#workflows">Workflows</a><a href="#ownership">Built differently</a><a href="#faq">FAQ</a></div>
      <div className="lp2-nav-actions"><a href="/sign-in">Sign in</a><a className="lp2-button small" href="/sign-up">Start free</a></div>
    </nav>

    <section className="lp2-hero lp2-hero-animated" data-reveal="hero">
      <div className="lp2-hero-copy">
        <span className="lp2-eyebrow">For pastors · Churches · Christian ministries</span>
        <h1>Email built for the work of ministry.</h1>
        <p>Lead people, not another inbox. Bring church communication, ministry follow-ups, scheduling, and your team’s email together in one thoughtful workspace.</p>
        <div className="lp2-actions"><a className="lp2-button" href="/sign-up">Start free <ArrowRight size={17}/></a><a className="lp2-text-link" href="#product">See it work</a></div>
        <div className="lp2-hero-note"><Clock3 size={17}/><span>Write → Schedule → Outbox → Send</span></div>
      </div>
      <div id="product" className="lp2-hero-product"><ProductMockup/></div>
    </section>

    <section className="lp2-proof" data-reveal="stagger">
      <div><span>Care for people.</span><span>Communicate clearly.</span><span>Stay focused on the mission.</span></div>
      <div className="lp2-proof-grid">{capabilityItems.map(([title,copy,Icon]) => <article key={title}><Icon size={22}/><strong>{title}</strong><p>{copy}</p></article>)}</div>
    </section>

    <section id="features" className="lp2-section" data-reveal="up">
      <div className="lp2-section-heading"><span className="lp2-eyebrow">Ministry communication, made simpler</span><h2>More time for people. Less time managing messages.</h2><p>From Sunday announcements to pastoral follow-ups, GSW Mail keeps the details of communication together so your attention can stay on the people you serve.</p></div>
      <div className="lp2-feature-grid">{featureCards.map(([num,title,copy,Icon]) => <article key={title}><span>{num}</span><Icon size={24}/><h3>{title}</h3><p>{copy}</p></article>)}</div>
    </section>

    <section className="lp2-schedule-section" data-reveal="split">
      <div className="lp2-schedule-copy"><span className="lp2-eyebrow">Plan ahead</span><h2>Prepare the message. Be present for the ministry.</h2><p>Church updates, volunteer reminders, outreach follow-ups, and recurring announcements shouldn’t depend on remembering to press Send at the right moment.</p><ul><li><Check/>Schedule announcements in advance</li><li><Check/>Keep recurring updates consistent</li><li><Check/>Make changes before delivery</li></ul></div>
      <div className="lp2-schedule-demo">
        <div className="lp2-send-card"><header><strong>Weekly ministry update</strong><span>Outbox</span></header><p>Here are this week’s service details, prayer updates, and volunteer reminders.</p><div><button>Now</button><button className="active">Later</button><button>Repeated</button></div><footer><Clock3 size={16}/><span>Every Friday · 8:00 AM</span></footer></div>
      </div>
    </section>

    <section className="lp2-outbox" data-reveal="outbox">
      <div className="lp2-section-heading compact"><span className="lp2-eyebrow">Outbox</span><h2>Prepared in advance. Still in your hands.</h2><p>Ministry plans change. Scheduled and recurring messages remain manageable before they send—edit, move, pause, or cancel when needed.</p></div>
      <OutboxFlow/>
    </section>

    <section id="workflows" className="lp2-workflows" data-reveal="stagger">
      <div className="lp2-section-heading"><span className="lp2-eyebrow">Built around ministry life</span><h2>Whether you lead a church or serve behind the scenes.</h2></div>
      <div className="lp2-workflow-grid">{workflows.map(([title,copy],index)=><article key={title}><span>0{index+1}</span><h3>{title}</h3><p>{copy}</p><ArrowRight size={19}/></article>)}</div>
    </section>

    <section className="lp2-ai" data-reveal="split">
      <div className="lp2-ai-copy"><span className="lp2-eyebrow">Thoughtful tools</span><h2>Let technology support the calling.</h2><p>Use connected tools to locate conversations, prepare a reply, coordinate meetings, and keep ministry administration from consuming the day.</p><div className="lp2-ai-tags"><span>Find the thread</span><span>Draft the reply</span><span>Create the event</span><span>Keep the context</span></div></div>
      <div className="lp2-ai-card"><div className="lp2-ai-message user">Find the ministry partners I need to follow up with this week.</div><div className="lp2-ai-message assistant"><Bot size={18}/><div><strong>I found 4 conversations.</strong><span>Danielle Carter · volunteer coordination</span><span>Jordan Thomas · leadership meeting</span><span>Ministry Team · Sunday preparation</span><button>Draft follow-ups</button></div></div></div>
    </section>

    <section id="ownership" className="lp2-ownership" data-reveal="split">
      <div><span className="lp2-eyebrow">Stewardship and independence</span><h2>Your ministry. Your identity.</h2></div>
      <div><p>A church or ministry should be able to communicate under its own name. GSW Mail supports your custom domain and is built on independently operated mail infrastructure—not simply a new interface over a consumer inbox.</p><div className="lp2-standards"><span><ShieldCheck/>Custom-domain identity</span><span><RefreshCw/>Modern sync + standards</span><span><Layers3/>Portable infrastructure</span></div></div>
    </section>

    <section className="lp2-platforms" data-reveal="stagger">
      <div className="lp2-section-heading compact"><span className="lp2-eyebrow">Serve wherever you are</span><h2>At church. In the community. On the go.</h2></div>
      <div className="lp2-platform-grid"><article><Mail/><h3>Web</h3><p>A focused workspace for correspondence, coordination, and ministry administration.</p></article><article><Smartphone/><h3>Mobile</h3><p>Keep up with messages, meetings, and ministry contacts when you’re away from your desk.</p></article><article><ShieldCheck/><h3>Your domain</h3><p>Use an email address that reflects your church or ministry’s own name.</p></article></div>
    </section>

    <section id="faq" className="lp2-faq" data-reveal="up">
      <div className="lp2-section-heading compact"><span className="lp2-eyebrow">Questions from ministry leaders</span><h2>A few things worth knowing.</h2></div>
      <div className="lp2-faq-grid">
        <article><h3>Is GSW Mail a separate email service?</h3><p>No. GSW Mail is built around its own independently operated mail stack and product workflows rather than simply wrapping a consumer inbox.</p></article>
        <article><h3>Can our church use its own domain?</h3><p>Yes. Custom-domain identity is a core part of how GSW Mail is designed.</p></article>
        <article><h3>Can we plan announcements ahead of time?</h3><p>Yes. Scheduled and recurring messages remain in Outbox before delivery, where you can edit or cancel them as plans change.</p></article>
        <article><h3>How is access to our ministry’s email handled?</h3><p>Connected tools are designed around explicit permissions. Identity access and mailbox access are separate rather than one blanket permission.</p></article>
      </div>
    </section>

    <section className="lp2-final" data-reveal="cta">
      <span className="lp2-eyebrow">For the work you’ve been called to do</span>
      <h2>Ministry deserves thoughtful tools.</h2>
      <p>Bring the messages, people, and plans of your ministry into one place—so more of your time can go toward serving others.</p>
      <a className="lp2-button" href="/sign-up">Start free <ArrowRight size={17}/></a>
    </section>

    <footer className="lp2-footer"><a className="lp2-brand" href="/"><BrandMark size={28}/><span>GSW Mail</span></a><div><a href="/support">Support</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/sign-in">Sign in</a></div><span>Guided Steps Wellness: The Community · Est. 2025</span></footer>
  </main>;
}
