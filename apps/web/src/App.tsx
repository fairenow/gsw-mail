import { ContactsPage } from "./pages/ContactsPage";
import { MailPage } from "./pages/MailPage";
import { SettingsPage } from "./pages/SettingsPage";
import { AppShell } from "./components/AppShell";

export function App() {
  const page = window.location.pathname === "/settings" ? <SettingsPage /> : window.location.pathname === "/contacts" ? <ContactsPage /> : <MailPage />;
  return <AppShell>{page}</AppShell>;
}

export default App;
