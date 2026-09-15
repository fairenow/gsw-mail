import { ContactsPage } from "./pages/ContactsPage";
import { MailPage } from "./pages/MailPage";
import { SettingsPage } from "./pages/SettingsPage";
import { AppShell } from "./components/AppShell";
import { SetupPage } from "./pages/SetupPage";
import { ControlCenterPage } from "./pages/ControlCenterPage";
import { CalendarPage } from "./pages/CalendarPage";

export function App() {
  if (window.location.pathname === "/setup") return <SetupPage />;
  if (window.location.pathname === "/control-center") return <ControlCenterPage />;
  const page = window.location.pathname === "/settings" ? <SettingsPage /> : window.location.pathname === "/contacts" ? <ContactsPage /> : window.location.pathname === "/calendar" ? <CalendarPage /> : <MailPage />;
  return <AppShell>{page}</AppShell>;
}

export default App;
