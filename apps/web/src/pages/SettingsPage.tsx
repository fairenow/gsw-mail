import { useEffect, useState } from "react";
import { api, type ProductSettings } from "../api";
import { requestAccountDeletion } from "../auth";
import { useAppShell } from "../components/AppShell";
import { RichTextEditor } from "../components/RichTextEditor";
import { MailWorkspace } from "../components/MailWorkspace";

type Section = "General" | "Signature" | "Compose" | "Contacts" | "Templates";
const sections: Section[] = ["General", "Signature", "Compose", "Contacts", "Templates"];

export function SettingsPage() {
  const { configureTopBar } = useAppShell();
  const [section, setSection] = useState<Section>("General");
  const [settings, setSettings] = useState<ProductSettings | null>(null);
  const [signature, setSignature] = useState<ProductSettings["signature"] | null>(null);
  const [notice, setNotice] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  useEffect(() => { void api.settings().then((value) => { setSettings(value); setSignature(value.signature); }).catch((err) => setNotice(err instanceof Error ? err.message : String(err))); }, []);
  useEffect(() => { configureTopBar({ search: "", searchPlaceholder: "Search settings", onSearchChange: () => undefined, onSearch: () => undefined, searchDisabled: true }); }, [configureTopBar]);
  if (!settings || !signature) return <MailWorkspace section="settings"><div className="gsw-product-loading">Loading settings...</div></MailWorkspace>;
  const saveSignature = async () => { try { const saved = await api.saveSignature(signature); setSignature(saved); setNotice("Signature saved"); } catch (err) { setNotice(err instanceof Error ? err.message : String(err)); } };
  const saveSettings = async (body: { general?: Record<string, unknown>; compose?: Record<string, unknown>; contacts?: Record<string, unknown> }) => { try { const saved = await api.updateSettings(body); setSettings((current) => current ? { ...current, ...saved } : current); setNotice("Settings saved"); } catch (err) { setNotice(err instanceof Error ? err.message : String(err)); } };
  const deleteAccount = async () => {
    setDeleteBusy(true);
    setNotice("");
    try {
      await requestAccountDeletion();
      setShowDeleteConfirm(false);
      setNotice("Check your email to confirm account deletion. If your session is recent, deletion may complete immediately.");
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Could not start account deletion.");
    } finally {
      setDeleteBusy(false);
    }
  };
  return <MailWorkspace section="settings"><main className="gsw-settings-layout"><aside className="gsw-settings-nav"><p>Workspace</p>{sections.map((item) => <button key={item} className={section === item ? "active" : ""} onClick={() => setSection(item)}>{item}{item === "Templates" && <small>Later</small>}</button>)}</aside>
      <section className="gsw-settings-content"><div className="gsw-page-heading"><div><p className="gsw-eyebrow">Preferences</p><h1>{section}</h1><p>{section === "Signature" ? "A reusable, editable identity for every message." : "Keep the parts of GSW Mail that make communication feel like yours."}</p></div>{notice && <span className="gsw-save-notice">{notice}</span>}</div>
        {section === "General" && <div className="gsw-settings-card"><label>Timezone<select value={String(settings.general.timezone ?? "America/Detroit")} onChange={(event) => setSettings({ ...settings, general: { ...settings.general, timezone: event.target.value } })}><option>America/Detroit</option><option>America/New_York</option><option>America/Chicago</option><option>UTC</option></select></label><label>Language<select value={String(settings.general.language ?? "en-US")} onChange={(event) => setSettings({ ...settings, general: { ...settings.general, language: event.target.value } })}><option value="en-US">English (US)</option></select></label><label>Profile image URL<input type="url" value={String(settings.general.profileImageUrl ?? "")} placeholder="https://example.com/profile.jpg" onChange={(event) => setSettings({ ...settings, general: { ...settings.general, profileImageUrl: event.target.value } })} /><small>Use a publicly accessible HTTPS image. Initials remain as a fallback.</small></label><button className="gsw-primary-btn" onClick={() => void saveSettings({ general: settings.general })}>Save general settings</button></div>}
        {section === "Signature" && <div className="gsw-settings-card"><div className="gsw-settings-card-head"><div><h2>Default signature</h2><p>Paste from Gmail, Outlook, Word, a website, or another editor. Unsafe scripts and links are removed.</p></div><label className="gsw-switch"><input type="checkbox" checked={signature.enabled} onChange={(event) => setSignature({ ...signature, enabled: event.target.checked })} /><span>Enabled</span></label></div><RichTextEditor value={signature.signatureHtml} onChange={(value) => setSignature({ ...signature, signatureHtml: value })} placeholder="Write your signature" minHeight={190} /><div className="gsw-option-grid"><label><input type="checkbox" checked={signature.onNew} onChange={(event) => setSignature({ ...signature, onNew: event.target.checked })} /> New messages</label><label><input type="checkbox" checked={signature.onReply} onChange={(event) => setSignature({ ...signature, onReply: event.target.checked })} /> Replies</label><label><input type="checkbox" checked={signature.onForward} onChange={(event) => setSignature({ ...signature, onForward: event.target.checked })} /> Forwards</label><label>Placement<select value={signature.position} onChange={(event) => setSignature({ ...signature, position: event.target.value as ProductSettings["signature"]["position"] })}><option value="beforeQuotedText">Before quoted history</option><option value="afterQuotedText">After quoted history</option></select></label></div><p className="gsw-muted">Plaintext preview: {signature.signatureText || "Your signature text will appear here."}</p><button className="gsw-primary-btn" onClick={() => void saveSignature()}>Save signature</button></div>}
        {section === "Compose" && <div className="gsw-settings-card"><h2>Compose preferences</h2><label className="gsw-setting-row"><span><strong>Rich text by default</strong><small>Keep formatting when pasting into new messages.</small></span><input type="checkbox" checked={settings.compose.defaultFormat !== "plain"} onChange={(event) => setSettings({ ...settings, compose: { ...settings.compose, defaultFormat: event.target.checked ? "rich" : "plain" } })} /></label><button className="gsw-primary-btn" onClick={() => void saveSettings({ compose: settings.compose })}>Save compose settings</button></div>}
        {section === "Contacts" && <div className="gsw-settings-card"><h2>Contact capture</h2><label className="gsw-setting-row"><span><strong>Create contacts from sent mail</strong><small>New recipients become lightweight contacts and existing contacts gain engagement history.</small></span><input type="checkbox" checked={settings.contacts.autoCreateFromSent !== false} onChange={(event) => setSettings({ ...settings, contacts: { ...settings.contacts, autoCreateFromSent: event.target.checked } })} /></label><a className="gsw-secondary-btn gsw-inline-btn" href="/contacts">Open contacts</a><button className="gsw-primary-btn" onClick={() => void saveSettings({ contacts: settings.contacts })}>Save contact settings</button></div>}
        {section === "Templates" && <div className="gsw-settings-card"><h2>Default email template</h2><p>Choose the presentation used for new outgoing messages. No Template sends only the message you compose, while the branded options add their project header and footer.</p><label>Template<select value={String(settings.general.templateKey ?? "none")} onChange={(event) => setSettings({ ...settings, general: { ...settings.general, templateKey: event.target.value } })}><option value="none">No Template</option><option value="gsw_default">Guided Steps Wellness: The Community</option><option value="bible_reader">Bible Study Reader</option></select></label><button className="gsw-primary-btn" onClick={() => void saveSettings({ general: settings.general })}>Save template</button></div>}
        <footer className="gsw-settings-legal-footer"><a href="/privacy">Privacy Policy</a><a href="/terms">Terms of Service</a><button type="button" className="gsw-settings-text-button danger" onClick={() => setShowDeleteConfirm((value) => !value)}>Delete account</button></footer>
        {showDeleteConfirm && <div className="gsw-delete-confirm"><p><strong>Delete your GSW Mail account?</strong></p><p>This removes your sign-in profile and personal GSW Mail settings. Organization-owned mailbox data or records may be retained as described in the Privacy Policy. This action cannot be undone.</p><div className="gsw-delete-confirm-actions"><button className="gsw-danger-btn" disabled={deleteBusy} onClick={() => void deleteAccount()}>{deleteBusy ? "Starting deletion…" : "Yes, delete my account"}</button><button className="gsw-secondary-btn" disabled={deleteBusy} onClick={() => setShowDeleteConfirm(false)}>Cancel</button></div></div>}
      </section></main></MailWorkspace>
}
