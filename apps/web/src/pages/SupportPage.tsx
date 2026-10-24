import { BrandMark } from "../components/auth/BrandMark";

const supportEmail = "admin@team.guidedstepswellness.com";

export function SupportPage() {
  return <main className="gsw-legal-page gsw-support-page">
    <header className="gsw-legal-header">
      <a className="gsw-legal-brand" href="/" aria-label="GSW Mail home"><BrandMark size={52} /><span>GSW Mail</span></a>
      <nav aria-label="Support navigation"><a href="/support" aria-current="page">Support</a><a href="/sign-in">Sign in</a></nav>
    </header>
    <article className="gsw-legal-card">
      <p className="gsw-legal-kicker">Guided Steps Wellness</p>
      <h1>GSW Mail support</h1>
      <p className="gsw-legal-intro">Get help with signing in, accessing your mailbox, sending email, or connecting GSW Mail to other apps.</p>
      <div className="gsw-support-contact">
        <a className="gsw-support-button" href={`mailto:${supportEmail}?subject=GSW%20Mail%20support`}>Email support</a>
        <a className="gsw-support-address" href={`mailto:${supportEmail}`}>{supportEmail}</a>
      </div>
      <section aria-labelledby="support-details">
        <h2 id="support-details">Tell us what happened</h2>
        <p>Include the email address associated with your GSW Mail account, a short description of the issue, and when it occurred. If you see an error, include its message or reference ID.</p>
        <p>You can also include your browser or app version and a screenshot with private information hidden.</p>
        <p><strong>Never send passwords, verification codes, recovery codes, or API keys.</strong> Remove private message content and attachments that are not needed to explain the issue.</p>
      </section>
      <section aria-labelledby="support-help">
        <h2 id="support-help">Common questions</h2>
        <h3>Having trouble signing in?</h3>
        <p>Check that you are using the email address for your GSW Mail account. Use the recovery options on the <a href="/sign-in">sign-in page</a>, or email support if you still cannot access your account.</p>
        <h3>Missing a mailbox or unable to send?</h3>
        <p>Check that you have selected the intended mailbox. If your mailbox belongs to a workspace, ask its administrator to confirm your access. For sending issues, include the time and error message so we can investigate.</p>
        <h3>Need help connecting ChatGPT or another app?</h3>
        <p>Sign in with the GSW Mail account that has access to your mailbox. Tell us which app you are connecting, which step failed, and any error message. Do not send authorization codes, tokens, or the full authorization URL.</p>
      </section>
    </article>
    <footer className="gsw-legal-footer"><span>© {new Date().getFullYear()} Guided Steps Wellness</span><a href="/privacy">Privacy Policy</a><a href="/terms">Terms of Service</a><a href="/">GSW Mail</a></footer>
  </main>;
}
