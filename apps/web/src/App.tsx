import { ContactsPage } from "./pages/ContactsPage";
import { MailPage } from "./pages/MailPage";
import { SettingsPage } from "./pages/SettingsPage";
import { AppShell } from "./components/AppShell";
import { SetupPage } from "./pages/SetupPage";

export function App() {
  if (window.location.pathname === "/setup") return <SetupPage />;
  const page = window.location.pathname === "/settings" ? <SettingsPage /> : window.location.pathname === "/contacts" ? <ContactsPage /> : <MailPage />;
  return <AppShell>{page}</AppShell>;
}

export default App;
