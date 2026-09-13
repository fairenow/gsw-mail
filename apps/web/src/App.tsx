import { ContactsPage } from "./pages/ContactsPage";
import { MailPage } from "./pages/MailPage";
import { SettingsPage } from "./pages/SettingsPage";

export function App() {
  if (window.location.pathname === "/settings") return <SettingsPage />;
  if (window.location.pathname === "/contacts") return <ContactsPage />;
  return <MailPage />;
}

export default App;
