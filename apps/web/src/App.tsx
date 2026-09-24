import { useEffect, useState } from "react";
import { ContactsPage } from "./pages/ContactsPage";
import { MailPage } from "./pages/MailPage";
import { SettingsPage } from "./pages/SettingsPage";
import { AppShell } from "./components/AppShell";
import { SetupPage } from "./pages/SetupPage";
import { ControlCenterPage } from "./pages/ControlCenterPage";
import { CalendarPage } from "./pages/CalendarPage";

const navigate = (href: string) => {
  const url = new URL(href, window.location.href);
  if (url.origin !== window.location.origin) return false;
  if (url.pathname === window.location.pathname && url.search === window.location.search && url.hash === window.location.hash) return true;
  window.history.pushState({}, "", `${url.pathname}${url.search}${url.hash}`);
  window.dispatchEvent(new PopStateEvent("popstate"));
  return true;
};

export function App() {
  const [path, setPath] = useState(() => window.location.pathname);

  useEffect(() => {
    const syncPath = () => setPath(window.location.pathname);
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
    return () => {
      window.removeEventListener("popstate", syncPath);
      document.removeEventListener("click", handleClick);
    };
  }, []);

  if (path === "/setup") return <SetupPage />;
  if (path === "/control-center") return <ControlCenterPage />;
  const page = path === "/settings" ? <SettingsPage /> : path === "/contacts" ? <ContactsPage /> : path === "/calendar" ? <CalendarPage /> : <MailPage />;
  return <AppShell>{page}</AppShell>;
}

export default App;
