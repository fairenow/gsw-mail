import { lazy, Suspense, useEffect, useState } from "react";
const ContactsPage = lazy(() => import("./pages/ContactsPage").then(module => ({ default: module.ContactsPage })));
const MailPage = lazy(() => import("./pages/MailPage").then(module => ({ default: module.MailPage })));
const SettingsPage = lazy(() => import("./pages/SettingsPage").then(module => ({ default: module.SettingsPage })));
import { AppShell } from "./components/AppShell";
const SetupPage = lazy(() => import("./pages/SetupPage").then(module => ({ default: module.SetupPage })));
const ControlCenterPage = lazy(() => import("./pages/ControlCenterPage").then(module => ({ default: module.ControlCenterPage })));
const CalendarPage = lazy(() => import("./pages/CalendarPage").then(module => ({ default: module.CalendarPage })));
const CampaignReviewPage = lazy(() => import("./pages/CampaignReviewPage").then(module => ({ default: module.CampaignReviewPage })));
const CalendarRsvpPage = lazy(() => import("./pages/CalendarRsvpPage").then(module => ({ default: module.CalendarRsvpPage })));
const LegalPage = lazy(() => import("./pages/LegalPage").then(module => ({ default: module.LegalPage })));
const AccountDeletedPage = lazy(() => import("./pages/LegalPage").then(module => ({ default: module.AccountDeletedPage })));
const LandingPage = lazy(() => import("./pages/LandingPage").then(module => ({ default: module.LandingPage })));
const SupportPage = lazy(() => import("./pages/SupportPage").then(module => ({ default: module.SupportPage })));
const OAuthAccountChooserPage = lazy(() => import("./pages/OAuthAccountChooserPage").then(module => ({ default: module.OAuthAccountChooserPage })));
const OAuthConsentPage = lazy(() => import("./pages/OAuthConsentPage").then(module => ({ default: module.OAuthConsentPage })));
const McpMailboxRecoveryPage = lazy(() => import("./pages/McpMailboxRecoveryPage").then(module => ({ default: module.McpMailboxRecoveryPage })));

const scrollToHash = (hash: string) => {
  if (!hash) return;
  const id = decodeURIComponent(hash.replace(/^#/, ""));
  if (!id) return;
  window.requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }));
};

const navigate = (href: string) => {
  const url = new URL(href, window.location.href);
  if (url.origin !== window.location.origin) return false;

  const sameDocument = url.pathname === window.location.pathname && url.search === window.location.search;
  if (sameDocument && url.hash) {
    if (url.hash !== window.location.hash) window.history.pushState({}, "", `${url.pathname}${url.search}${url.hash}`);
    scrollToHash(url.hash);
    return true;
  }

  if (url.pathname === window.location.pathname && url.search === window.location.search && url.hash === window.location.hash) return true;
  window.history.pushState({}, "", `${url.pathname}${url.search}${url.hash}`);
  window.dispatchEvent(new PopStateEvent("popstate"));
  if (url.hash) scrollToHash(url.hash);
  return true;
};

function RouteLoading() {
  return <div className="gsw-route-loading" role="status" aria-label="Loading page"><div className="gsw-route-loading-bar" /><span className="gsw-sr-only">Loading page</span></div>;
}

function renderRoute(path: string) {
  if (path === "/") return <LandingPage />;
  if (path === "/privacy") return <LegalPage kind="privacy" />;
  if (path === "/terms") return <LegalPage kind="terms" />;
  if (path === "/support") return <SupportPage />;
  if (path === "/account-deleted") return <AccountDeletedPage />;
  if (path === "/calendar/rsvp") return <CalendarRsvpPage />;
  if (path === "/oauth/select-account") return <OAuthAccountChooserPage />;
  if (path === "/oauth/consent") return <OAuthConsentPage />;
  if (path === "/settings/mcp-mailbox-recovery") return <McpMailboxRecoveryPage />;
  if (path === "/setup") return <SetupPage />;
  if (path === "/control-center") return <ControlCenterPage />;
  const page = /^\/campaigns\/[0-9a-f-]{36}$/i.test(path) ? <CampaignReviewPage /> : path === "/settings" ? <SettingsPage /> : path === "/contacts" ? <ContactsPage /> : path === "/calendar" ? <CalendarPage /> : path === "/files" ? <MailPage initialSection="files" /> : <MailPage />;
  return <AppShell><Suspense fallback={<RouteLoading />}>{page}</Suspense></AppShell>;
}

export function App() {
  const [path, setPath] = useState(() => window.location.pathname);

  useEffect(() => {
    const syncPath = () => {
      setPath(window.location.pathname);
      if (window.location.hash) scrollToHash(window.location.hash);
    };
    const handleClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(target instanceof HTMLAnchorElement) || target.target || target.hasAttribute("download")) return;
      const url = new URL(target.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      event.preventDefault();
      navigate(url.href);
    };

    window.addEventListener("popstate", syncPath);
    document.addEventListener("click", handleClick);
    if (window.location.hash) scrollToHash(window.location.hash);
    return () => {
      window.removeEventListener("popstate", syncPath);
      document.removeEventListener("click", handleClick);
    };
  }, []);

  return <Suspense fallback={<RouteLoading />}>{renderRoute(path)}</Suspense>;
}

export default App;
