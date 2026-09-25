import { BrandMark } from "../components/auth/BrandMark";

type LegalKind = "privacy" | "terms";

type LegalSection = { title: string; paragraphs?: string[]; bullets?: string[] };

const lastUpdated = "September 24, 2026";

const privacySections: LegalSection[] = [
  {
    title: "1. Overview",
    paragraphs: [
      "This Privacy Policy explains how Guided Steps Wellness (\"GSW,\" \"we,\" \"us,\" or \"our\") collects, uses, stores, shares, and protects information when you use GSW Mail, mail.guidedstepswellness.com, our mobile applications, and related services (collectively, the \"Services\").",
      "GSW Mail is designed for email, contacts, calendar, workspace administration, authentication, and related communication features. If your account is provided through an organization or workspace, that organization may control certain mailbox content, membership, retention, and administrative settings.",
    ],
  },
  {
    title: "2. Information we collect",
    bullets: [
      "Account information, such as your name, email address, verified recovery information, authentication records, profile image, and account settings.",
      "Email and mailbox data, including message content, recipients, attachments, folders, message metadata, delivery status, signatures, drafts, and related communication records needed to provide the Service.",
      "Contacts and calendar information that you create, import, or synchronize through the Service.",
      "Workspace and administrative data, such as domains, mailbox assignments, roles, permissions, aliases, organization membership, and configuration settings.",
      "Device and technical information, such as IP address, browser or app type, operating system, device identifiers, push-notification tokens, logs, diagnostics, and security events.",
      "Usage information, such as features used, synchronization activity, login activity, delivery events, and actions taken within the Service.",
      "Information you send to us when you contact support, report a problem, or otherwise communicate with us.",
    ],
  },
  {
    title: "3. How we use information",
    bullets: [
      "Provide, operate, synchronize, maintain, and improve GSW Mail and its web and mobile experiences.",
      "Authenticate users, maintain sessions, prevent account takeover, and protect the Service from fraud, abuse, spam, and security threats.",
      "Send and receive email, process attachments, maintain contacts and calendar information, and deliver push notifications you have enabled.",
      "Administer workspaces, domains, mailboxes, roles, account recovery, billing or service-related records, and customer support.",
      "Troubleshoot reliability and performance issues, investigate errors, and understand how the Service is used.",
      "Comply with legal obligations, enforce our Terms of Service, protect users and third parties, and preserve the integrity of the Service.",
    ],
  },
  {
    title: "4. How information is shared",
    paragraphs: ["We do not sell your personal information. We may disclose information only as reasonably necessary to operate the Service or as permitted by law."],
    bullets: [
      "Service providers and infrastructure partners that support hosting, email delivery, authentication, databases, notifications, monitoring, and other operational functions. They receive only the information needed to perform their services for us.",
      "Your organization or workspace administrators, where your account is managed as part of an organization. Administrators may be able to manage mailbox access, membership, domains, settings, and business records associated with the workspace.",
      "Recipients and other users when you send email, share calendar information, or otherwise communicate through the Service.",
      "Authorities, regulators, or other parties when required by law, legal process, or a good-faith need to protect rights, safety, security, or the integrity of the Service.",
      "A successor organization in connection with a merger, acquisition, financing, reorganization, or sale of assets, subject to appropriate confidentiality and data-protection obligations.",
    ],
  },
  {
    title: "5. Cookies, sessions, and local storage",
    paragraphs: [
      "We use cookies, secure session storage, device storage, and similar technologies to keep you signed in, protect your account, remember preferences, and support core product functionality. We do not use these technologies to sell personal information.",
    ],
  },
  {
    title: "6. Security",
    paragraphs: [
      "We use administrative, technical, and organizational safeguards intended to protect information, including encrypted network connections, access controls, authentication safeguards, token-based authorization, monitoring, and secure development practices. No method of storage or transmission is completely secure, so we cannot guarantee absolute security.",
    ],
  },
  {
    title: "7. Retention and deletion",
    paragraphs: [
      "We retain information for as long as reasonably necessary to provide the Service, maintain security and reliability, comply with legal obligations, resolve disputes, and enforce agreements.",
      "You may initiate account deletion from Settings. Deleting your account removes your GSW sign-in profile and personal product data associated with that profile. Mailbox or workspace records may be retained when they belong to an organization, are needed to preserve shared business records, are subject to legal or security retention requirements, or remain in backups for a limited period before routine deletion or overwrite.",
      "When an account owns an active mailbox, account deletion disables that mailbox association. Workspace administrators may need to reassign or separately remove organization-owned mailbox data.",
    ],
  },
  {
    title: "8. Your choices and rights",
    bullets: [
      "Review and update profile and preference information through the Service where available.",
      "Control supported notification preferences and revoke system-level notification permissions through your device settings.",
      "Delete your account through Settings or contact us if you need assistance with an access, correction, or deletion request.",
      "Depending on where you live, applicable law may give you additional rights to access, correct, delete, restrict, object to, or receive a copy of certain personal information.",
    ],
  },
  {
    title: "9. Children's privacy",
    paragraphs: ["The Service is not directed to children under 13, and we do not knowingly collect personal information from children under 13 without appropriate authorization. If you believe a child has provided us personal information improperly, contact us so we can review the matter."],
  },
  {
    title: "10. International processing",
    paragraphs: ["Our service providers and systems may process information in the United States and other locations. Where required, we use appropriate safeguards for cross-border transfers."],
  },
  {
    title: "11. Changes to this policy",
    paragraphs: ["We may update this Privacy Policy as the Service changes. We will post the current version at this page and update the effective date. Material changes may also be communicated through the Service or by other reasonable means."],
  },
  {
    title: "12. Contact us",
    paragraphs: ["Questions or privacy requests may be sent to privacy@guidedstepswellness.com."],
  },
];

const termsSections: LegalSection[] = [
  {
    title: "1. Agreement to these terms",
    paragraphs: [
      "These Terms of Service (\"Terms\") govern your access to and use of GSW Mail, mail.guidedstepswellness.com, our mobile applications, and related services (collectively, the \"Services\"). By creating an account, accessing, or using the Services, you agree to these Terms and our Privacy Policy.",
      "If you use the Services on behalf of an organization, you represent that you have authority to bind that organization to these Terms.",
    ],
  },
  {
    title: "2. Your account",
    bullets: [
      "Provide accurate information and keep your account and recovery information current.",
      "Protect your credentials, devices, and sessions and notify us if you believe your account has been compromised.",
      "You are responsible for activity performed through your account unless caused by a failure of the Service for which you are not responsible.",
      "Workspace administrators may manage organization-owned accounts, mailboxes, domains, membership, access, and retention settings.",
    ],
  },
  {
    title: "3. Acceptable use",
    paragraphs: ["You may not use the Services to violate law, harm others, interfere with the Service, or abuse email infrastructure."],
    bullets: [
      "Do not send spam, phishing, malware, unlawful bulk email, deceptive messages, or content that infringes the rights of others.",
      "Do not attempt unauthorized access, probe or bypass security controls, disrupt infrastructure, reverse engineer protected portions of the Service where prohibited by law, or use the Service to attack another system.",
      "Do not impersonate another person or organization, misrepresent message origins, or use domains or addresses you are not authorized to use.",
      "Do not use the Service in a way that creates unreasonable technical load, damages deliverability, or places other users or GSW at risk.",
    ],
  },
  {
    title: "4. Your content",
    paragraphs: [
      "You retain ownership of content you create or transmit through the Services. You grant us the limited rights necessary to host, process, transmit, synchronize, scan for security and abuse, back up, and otherwise handle that content solely to provide, protect, and improve the Services.",
      "You are responsible for having the rights and permissions necessary to send, upload, or share your content. Email recipients may retain copies of messages after you delete them from your account.",
    ],
  },
  {
    title: "5. Service providers and third-party services",
    paragraphs: ["The Services rely on third-party infrastructure and providers for hosting, authentication, email delivery, notifications, and related functions. Their availability may affect the Services. Third-party products or websites that you choose to use may be governed by their own terms and privacy policies."],
  },
  {
    title: "6. Service changes and availability",
    paragraphs: ["We may add, change, limit, suspend, or discontinue features as we improve the Services or respond to operational, security, legal, or business requirements. We work to provide reliable service but do not guarantee uninterrupted or error-free operation."],
  },
  {
    title: "7. Suspension and termination",
    paragraphs: ["We may suspend or restrict access when reasonably necessary to protect users, preserve security or deliverability, investigate suspected abuse, comply with law, or enforce these Terms. You may stop using the Services at any time and may initiate account deletion from Settings."],
  },
  {
    title: "8. Account deletion",
    paragraphs: ["Account deletion permanently removes your GSW sign-in profile and associated personal product data, subject to the retention terms in our Privacy Policy. Organization-owned mailbox content, shared business records, security logs, legal records, and backups may be retained when reasonably necessary or controlled by the applicable workspace."],
  },
  {
    title: "9. Intellectual property",
    paragraphs: ["The Services, including software, designs, branding, interfaces, documentation, and other materials provided by GSW, are owned by or licensed to us and are protected by applicable intellectual-property laws. These Terms do not transfer ownership of the Services to you."],
  },
  {
    title: "10. Feedback",
    paragraphs: ["If you provide suggestions or feedback, you allow us to use that feedback without restriction or compensation, provided we do not publicly identify you as the source without permission."],
  },
  {
    title: "11. Disclaimers",
    paragraphs: ["To the maximum extent permitted by law, the Services are provided \"as is\" and \"as available.\" We disclaim implied warranties of merchantability, fitness for a particular purpose, non-infringement, and warranties arising from course of dealing or usage of trade. We do not guarantee that every email will be delivered, received, filtered, stored, or synchronized without delay or error."],
  },
  {
    title: "12. Limitation of liability",
    paragraphs: ["To the maximum extent permitted by law, GSW and its affiliates, officers, employees, and service providers will not be liable for indirect, incidental, special, consequential, exemplary, or punitive damages, or for lost profits, revenues, data, goodwill, or business opportunities arising from or related to the Services. Where liability cannot be excluded, it will be limited to the amount you paid for the Services during the 12 months before the event giving rise to the claim, or $100 if you paid nothing, unless applicable law requires a different result."],
  },
  {
    title: "13. Indemnity",
    paragraphs: ["If you use the Services on behalf of a business or organization, to the extent permitted by law, that organization will defend and indemnify GSW against third-party claims arising from its unlawful use of the Services, its content, or its violation of these Terms."],
  },
  {
    title: "14. Governing law",
    paragraphs: ["These Terms are governed by the laws of the State of Michigan, without regard to conflict-of-law rules, except where the law of your jurisdiction requires otherwise. Courts with appropriate jurisdiction in Michigan will have jurisdiction over disputes that are not otherwise required to be resolved elsewhere by applicable law."],
  },
  {
    title: "15. Changes to these terms",
    paragraphs: ["We may update these Terms from time to time. We will post the revised Terms with an updated effective date. If a change materially affects your rights, we may provide additional notice. Continued use of the Services after the effective date of revised Terms means you accept them to the extent permitted by law."],
  },
  {
    title: "16. Contact",
    paragraphs: ["Questions about these Terms may be sent to privacy@guidedstepswellness.com."],
  },
];

export function LegalPage({ kind }: { kind: LegalKind }) {
  const isPrivacy = kind === "privacy";
  const sections = isPrivacy ? privacySections : termsSections;
  return <main className="gsw-legal-page">
    <header className="gsw-legal-header">
      <a href="/" className="gsw-legal-brand" aria-label="Guided Steps Wellness Mail home"><BrandMark size={52} /><span>GSW Mail</span></a>
      <nav><a href="/privacy" aria-current={isPrivacy ? "page" : undefined}>Privacy</a><a href="/terms" aria-current={!isPrivacy ? "page" : undefined}>Terms</a></nav>
    </header>
    <article className="gsw-legal-card">
      <p className="gsw-legal-kicker">Guided Steps Wellness</p>
      <h1>{isPrivacy ? "Privacy Policy" : "Terms of Service"}</h1>
      <p className="gsw-legal-updated">Last updated: {lastUpdated}</p>
      <p className="gsw-legal-intro">{isPrivacy ? "We believe privacy should be understandable. This policy describes the information GSW Mail handles, why we use it, and the choices available to you." : "These terms explain the rules for using GSW Mail and the responsibilities that come with an account."}</p>
      {sections.map((section) => <section key={section.title}><h2>{section.title}</h2>{section.paragraphs?.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}{section.bullets && <ul>{section.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}</ul>}</section>)}
    </article>
    <footer className="gsw-legal-footer"><span>© 2026 Guided Steps Wellness</span><a href="/privacy">Privacy Policy</a><a href="/terms">Terms of Service</a><a href="/sign-in">GSW Mail</a></footer>
  </main>;
}

export function AccountDeletedPage() {
  return <main className="gsw-legal-page gsw-account-deleted"><article className="gsw-legal-card"><BrandMark size={72} /><p className="gsw-legal-kicker">GSW Mail</p><h1>Account deletion confirmed</h1><p>Your GSW sign-in account has been deleted. Some organization-owned records or limited backups may be retained as described in our Privacy Policy.</p><div className="gsw-legal-actions"><a href="/privacy">Read the Privacy Policy</a><a href="/sign-in">Return to GSW Mail</a></div></article></main>;
}
