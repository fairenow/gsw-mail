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

function ProductPreview() {
  return <div className="landing-preview-window" aria-label="GSW Mail product preview">
    <div className="landing-preview-topbar">
      <span /><span /><span />
      <div className="landing-preview-search">Search mail</div>
    </div>
    <div className="landing-preview-body">
      <aside className="landing-preview-sidebar">
        <button>＋ Compose</button>
        {['Inbox','Starred','Sent','Drafts','Outbox','Archive'].map((item, index) => <div key={item} className={index === 0 ? 'active' : ''}><span>{item}</span><small>{index === 0 ? '8' : index === 3 ? '3' : ''}</small></div>)}
      </aside>
      <section className="landing-preview-mail">
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
      </section>
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
      <ProductPreview />
    </section>

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
        <p>We’re testing GSW as an OAuth/OpenID Connect identity provider. The flow works like the familiar “Continue with Google” experience, while identity access stays separate from your mailbox and product data.</p>
        <div className="landing-oauth-scopes"><span>Basic identity</span><span>Profile</span><span>Email address</span><b>No mailbox access</b></div>
      </div>
      <div className="landing-oauth-card">
        <BrandMark size={56} />
        <strong>Try the GSW OAuth flow</strong>
        <p>This launches the real PKCE + consent test client.</p>
        <a className="landing-oauth-button" href="/oauth/test"><BrandMark size={22} /><span>Continue with GSW</span></a>
        <small>Developer preview · identity only</small>
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
