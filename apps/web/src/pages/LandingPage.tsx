import { useEffect, useRef, useState } from "react";
import { BrandMark } from "../components/auth/BrandMark";

const featureRows = [
  {
    eyebrow: "Inbox",
    title: "A calmer place to handle the work that matters.",
    copy: "Move through mail quickly with a focused inbox, clean threading, drafts, search, flags, folders, and the actions you expect without the clutter around them.",
    visual: "inbox",
  },
  {
    eyebrow: "Send on your time",
    title: "Schedule once. Or make it recurring.",
    copy: "Plan messages for later, manage scheduled mail from Outbox, and use recurring sends when communication needs to happen more than once.",
    visual: "schedule",
  },
  {
    eyebrow: "Your identity",
    title: "Bring your own domain and make email yours.",
    copy: "Use GSW Mail with your own domain, signatures, contacts, calendar, and account preferences in one straightforward workspace.",
    visual: "identity",
  },
] as const;

const showcaseSteps = [
  { key: "inbox", label: "Inbox", title: "Move through what matters." },
  { key: "compose", label: "Compose", title: "Write. Send. Keep moving." },
  { key: "calendar", label: "Calendar", title: "Turn messages into time." },
  { key: "contacts", label: "Contacts", title: "Keep people close." },
  { key: "templates", label: "Templates", title: "Reuse what works." },
  { key: "assistant", label: "Assistant", title: "Ask. Act. Keep moving." },
] as const;

type ShowcaseKey = (typeof showcaseSteps)[number]["key"];

function InboxScreen() {
  return <section className="landing-preview-mail">
    <div className="landing-preview-title"><div><strong>Inbox</strong><small>Stay focused on what needs you.</small></div><span>RW</span></div>
    {[
      ['Danielle Carter','Re: Anchored Learning partnership','Thanks Ramon — I took a look at the proposal and would love to keep the conversation moving.','2:18 PM'],
      ['Project Team','Launch checklist for Friday','The final review is ready. I added the deployment notes and ownership for each remaining item.','11:42 AM'],
      ['Jordan Lee','Coffee next week?','Tuesday morning works well for me. Want to meet near downtown?','9:06 AM'],
      ['GSW Calendar','Tomorrow: Product review','Your meeting starts tomorrow at 10:00 AM.','Yesterday'],
    ].map((row, index) => <div className={`landing-preview-row ${index === 0 ? 'selected' : ''}`} key={row[0]}>
      <span className="landing-preview-avatar">{row[0].slice(0,1)}</span>
      <div><strong>{row[0]}</strong><b>{row[1]}</b><small>{row[2]}</small></div>
      <time>{row[3]}</time>
    </div>)}
  </section>;
}

function ComposeScreen() {
  return <section className="landing-showcase-panel landing-showcase-compose">
    <div className="landing-compose-window">
      <div className="landing-compose-head"><strong>New message</strong><span>×</span></div>
      <div className="landing-compose-field"><span>To</span><strong>danielle@example.org</strong></div>
      <div className="landing-compose-field"><span>Subject</span><strong>Following up on our conversation</strong></div>
      <div className="landing-compose-body">Hi Danielle,<br /><br />Thanks again for taking the time to connect. I wanted to follow up with the next steps we discussed and keep things moving.</div>
      <div className="landing-compose-footer"><button>Send</button><button className="quiet">Schedule</button><span>Saved</span></div>
    </div>
  </section>;
}

function CalendarScreen() {
  return <section className="landing-showcase-panel landing-showcase-calendar">
    <div className="landing-calendar-head"><strong>October</strong><span>Week</span></div>
    <div className="landing-calendar-grid">
      {['Mon 5','Tue 6','Wed 7','Thu 8','Fri 9'].map((day) => <div className="landing-calendar-day" key={day}><b>{day}</b></div>)}
      <div className="landing-calendar-event event-a"><strong>Product review</strong><span>10:00 AM</span></div>
      <div className="landing-calendar-event event-b"><strong>Ministry outreach</strong><span>1:30 PM</span></div>
      <div className="landing-calendar-event event-c"><strong>Team check-in</strong><span>3:00 PM</span></div>
    </div>
    <div className="landing-calendar-pop"><small>New event</small><strong>Follow-up call</strong><span>Thursday · 2:00 PM</span><button>Add event</button></div>
  </section>;
}

function ContactsScreen() {
  return <section className="landing-showcase-panel landing-showcase-contacts">
    <div className="landing-contacts-list">
      {[
        ['DC','Danielle Carter','Anchored Learning'],
        ['JL','Jordan Lee','Community Partner'],
        ['MB','Marcus Brooks','Project Lead'],
        ['SR','Sophia Reed','Ministry Network'],
      ].map((contact, index) => <div className={`landing-contact-row ${index === 0 ? 'active' : ''}`} key={contact[1]}><span>{contact[0]}</span><div><strong>{contact[1]}</strong><small>{contact[2]}</small></div></div>)}
    </div>
    <div className="landing-contact-detail"><span className="landing-contact-avatar">DC</span><h3>Danielle Carter</h3><p>danielle@example.org</p><div><button>Email</button><button>Schedule</button></div><small>Last contacted 2 days ago</small></div>
  </section>;
}

function TemplatesScreen() {
  return <section className="landing-showcase-panel landing-showcase-templates">
    <div className="landing-template-list">
      {['Warm introduction','Meeting follow-up','Partnership outreach','Thank you'].map((name, index) => <button className={index === 1 ? 'active' : ''} key={name}><strong>{name}</strong><small>{index === 1 ? 'Used 18 times' : 'Saved template'}</small></button>)}
    </div>
    <div className="landing-template-editor"><small>Template</small><h3>Meeting follow-up</h3><div className="landing-template-subject">Subject: Great speaking with you</div><p>Hi {'{{first_name}}'},</p><p>Thanks again for taking the time to meet. I wanted to follow up with the next steps we discussed.</p><div className="landing-template-actions"><button>Use template</button><span>Updated today</span></div></div>
  </section>;
}

function AssistantScreen() {
  return <section className="landing-showcase-panel landing-showcase-assistant">
    <div className="landing-ai-sidebar"><BrandMark size={38} /><strong>GSW Assistant</strong><span>Inbox</span><span>Calendar</span><span>Contacts</span></div>
    <div className="landing-ai-chat">
      <div className="landing-ai-message user">Find the people I owe a follow-up to this week.</div>
      <div className="landing-ai-message assistant"><strong>I found 4 conversations.</strong><span>Danielle Carter · partnership follow-up</span><span>Jordan Lee · coffee scheduling</span><span>Marcus Brooks · project review</span><button>Draft follow-ups</button></div>
      <div className="landing-ai-input">Ask GSW to help with your work… <span>↑</span></div>
    </div>
  </section>;
}

function ShowcaseScreen({ active }: { active: ShowcaseKey }) {
  if (active === "compose") return <ComposeScreen />;
  if (active === "calendar") return <CalendarScreen />;
  if (active === "contacts") return <ContactsScreen />;
  if (active === "templates") return <TemplatesScreen />;
  if (active === "assistant") return <AssistantScreen />;
  return <InboxScreen />;
}

function ProductShowcase() {
  const sectionRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    const update = () => {
      const section = sectionRef.current;
      if (!section || window.matchMedia('(max-width: 900px)').matches) return;
      const rect = section.getBoundingClientRect();
      const travel = section.offsetHeight - window.innerHeight;
      if (travel <= 0) return;
      const progress = Math.max(0, Math.min(1, -rect.top / travel));
      setActiveIndex(Math.min(showcaseSteps.length - 1, Math.floor(progress * showcaseSteps.length)));
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => { window.removeEventListener('scroll', update); window.removeEventListener('resize', update); };
  }, []);

  const active = showcaseSteps[activeIndex];
  return <div ref={sectionRef} className="landing-showcase-scroll">
    <div className="landing-showcase-sticky">
      <div className="landing-showcase-copy">
        <span>{active.label}</span>
        <h2 key={active.key}>{active.title}</h2>
        <div className="landing-showcase-progress" aria-label={`Step ${activeIndex + 1} of ${showcaseSteps.length}`}>
          {showcaseSteps.map((step, index) => <button key={step.key} className={index === activeIndex ? 'active' : ''} onClick={() => setActiveIndex(index)} aria-label={step.label}><span /></button>)}
        </div>
      </div>
      <div className="landing-preview-window landing-showcase-window" aria-label="GSW Mail product preview">
        <div className="landing-preview-topbar">
          <span /><span /><span />
          <div className="landing-preview-search">Search GSW Mail</div>
        </div>
        <div className="landing-preview-body">
          <aside className="landing-preview-sidebar">
            <button>＋ Compose</button>
            {['Inbox','Calendar','Contacts','Templates','Assistant'].map((item) => <div key={item} className={item.toLowerCase() === active.key ? 'active' : ''}><span>{item}</span><small>{item === 'Inbox' ? '8' : ''}</small></div>)}
          </aside>
          <div className="landing-showcase-stage" key={active.key}><ShowcaseScreen active={active.key} /></div>
        </div>
      </div>
    </div>
  </div>;
}

function FeatureVisual({ kind }: { kind: 'inbox' | 'schedule' | 'identity' }) {
  if (kind === 'schedule') return <div className="landing-feature-visual schedule">
    <div className="landing-mini-compose">
      <div className="landing-mini-head"><span>New message</span><small>×</small></div>
      <p><b>To</b> team@example.com</p>
      <p><b>Subject</b> Weekly project update</p>
      <div className="landing-mini-message">Here’s the latest progress and what we’re focused on next week.</div>
      <div className="landing-mini-actions"><button>Send later</button><span>Every Friday · 8:00 AM</span></div>
    </div>
  </div>;
  if (kind === 'identity') return <div className="landing-feature-visual identity">
    <div className="landing-domain-card"><small>Your domain</small><strong>you@yourcompany.com</strong><span>✓ Domain connected</span></div>
    <div className="landing-domain-card"><small>Your workspace</small><strong>Mail · Calendar · Contacts</strong><span>One GSW account</span></div>
  </div>;
  return <div className="landing-feature-visual inbox">
    {['Needs reply','Priority','Everything else'].map((label, index) => <div className="landing-inbox-chip" key={label}><span>{index === 0 ? '↩' : index === 1 ? '★' : '☰'}</span><div><strong>{label}</strong><small>{index === 0 ? '4 conversations' : index === 1 ? '8 important messages' : 'Inbox organized your way'}</small></div></div>)}
  </div>;
}

export function LandingPage() {
  return <main className="landing-shell">
    <nav className="landing-nav">
      <a className="landing-brand" href="/"><BrandMark size={34} /><span>GSW Mail</span></a>
      <div className="landing-nav-links">
        <a href="#features">Features</a>
        <a href="#ownership">Built differently</a>
        <a href="#oauth">OAuth</a>
      </div>
      <div className="landing-nav-actions">
        <a className="landing-link-button" href="/sign-in">Sign in</a>
        <a className="landing-primary small" href="/sign-up">Start free</a>
      </div>
    </nav>

    <section className="landing-hero">
      <div className="landing-kicker">Email built for your domain and your day</div>
      <h1>Your inbox should help you move.</h1>
      <p>GSW Mail brings email, scheduling, contacts, calendar, and custom-domain identity into one focused workspace that feels fast, clear, and yours.</p>
      <div className="landing-hero-actions">
        <a className="landing-primary" href="/sign-up">Start free</a>
        <a className="landing-secondary" href="/sign-in">Sign in to GSW Mail</a>
      </div>
      <div className="landing-hero-proof"><span>Custom domains</span><span>Scheduled + recurring mail</span><span>Web + mobile</span></div>
    </section>

    <ProductShowcase />

    <section className="landing-value-strip" aria-label="GSW Mail highlights">
      <div><strong>Your domain</strong><span>Professional email without giving up your identity.</span></div>
      <div><strong>Your workflow</strong><span>Mail, calendar, contacts, drafts, and scheduling together.</span></div>
      <div><strong>Your account</strong><span>A reusable GSW identity designed to connect safely to other apps.</span></div>
    </section>

    <section id="features" className="landing-features">
      <div className="landing-section-heading"><span>Built around the workday</span><h2>Less friction between reading, deciding, and sending.</h2></div>
      {featureRows.map((feature, index) => <article className={`landing-feature-row ${index % 2 ? 'reverse' : ''}`} key={feature.title}>
        <div className="landing-feature-copy"><span>{feature.eyebrow}</span><h3>{feature.title}</h3><p>{feature.copy}</p></div>
        <FeatureVisual kind={feature.visual} />
      </article>)}
    </section>

    <section id="ownership" className="landing-ownership">
      <div>
        <span className="landing-section-label">Built differently</span>
        <h2>Email infrastructure you can actually own and operate.</h2>
      </div>
      <div>
        <p>GSW Mail is built around an independently operated mail stack instead of being a thin skin over somebody else’s consumer inbox. That gives the product room to evolve around custom domains, workflows, integrations, and the people using it.</p>
        <a href="/sign-up">Create your GSW account →</a>
      </div>
    </section>

    <section id="oauth" className="landing-oauth-section">
      <div className="landing-oauth-copy">
        <span className="landing-section-label">GSW Identity</span>
        <h2>One account. Safe connections to the apps you choose.</h2>
        <p>Use your GSW Account with apps that support GSW sign-in. Identity access stays separate from your mailbox, messages, calendar, contacts, and other product data unless a product explicitly requests and receives separate access.</p>
        <div className="landing-oauth-scopes"><span>Basic identity</span><span>Profile</span><span>Email address</span><b>No mailbox access</b></div>
      </div>
      <div className="landing-oauth-card">
        <BrandMark size={56} />
        <strong>Continue with your GSW Account</strong>
        <p>Choose an account and approve the identity information you want to share.</p>
        <a className="landing-oauth-button" href="/oauth/connect"><BrandMark size={22} /><span>Continue with GSW</span></a>
        <small>Identity only</small>
      </div>
    </section>

    <section className="landing-final-cta">
      <span>Ready when you are.</span>
      <h2>Make email feel like your workspace again.</h2>
      <div><a className="landing-primary" href="/sign-up">Start free</a><a className="landing-secondary light" href="/sign-in">Sign in</a></div>
    </section>

    <footer className="landing-footer">
      <a className="landing-brand" href="/"><BrandMark size={28} /><span>GSW Mail</span></a>
      <div><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/sign-in">Sign in</a></div>
      <span>Guided Steps Wellness</span>
    </footer>
  </main>;
}
