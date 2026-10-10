import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import "./styles/globals.css";
import "./styles/auth.css";
import "./styles/oauth-account-chooser.css";
import "./styles/oauth-consent.css";
import "./styles/oauth-test.css";
import "./styles/landing.css";
import "./styles/landing-showcase-motion.css";
import "./styles/landing-page-motion.css";
import "./styles/setup-dns.css";
import "./styles/mail.css";
import "./styles/header-brand-fix.css";
import "./styles/scheduled-send.css";
import "./styles/mail-row-fix.css";
import "./styles/product.css";
import "./styles/settings-legal-fix.css";
import "./styles/control-center.css";
import "./styles/calendar.css";
import "./styles/skeletons.css";
import "./styles/legal.css";
import "./styles/rsvp.css";
import { AuthGate } from "./AuthGate";
import { App } from "./App";
import { startEngagementAnalytics } from "./lib/engagementAnalytics";

const PUBLIC_PATHS = new Set(["/", "/privacy", "/terms", "/account-deleted", "/calendar/rsvp", "/oauth/connect", "/oauth/test", "/oauth/test/callback"]);

function Root() {
  const [path, setPath] = useState(() => window.location.pathname);

  useEffect(() => {
    const sync = () => setPath(window.location.pathname);
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  const publicPath = PUBLIC_PATHS.has(path);
  return publicPath ? <App /> : <AuthGate key={path}><App /></AuthGate>;
}

startEngagementAnalytics();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
