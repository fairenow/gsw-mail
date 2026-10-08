import { useEffect, useMemo, useState, type ChangeEvent, type ReactNode } from "react";
import { api, type EmailTemplateInput, type EmailTemplateOption, type EmailTemplateTheme, type ProductSettings } from "../api";
import { requestAccountDeletion } from "../auth";
import { useAppShell } from "../components/AppShell";
import { RichTextEditor } from "../components/RichTextEditor";
import { MailWorkspace } from "../components/MailWorkspace";

type Section = "General" | "Signature" | "Compose" | "Contacts" | "AI" | "Templates";
const sections: Section[] = ["General", "Signature", "Compose", "Contacts", "AI", "Templates"];
const CREATE_TEMPLATE_KEY = "__create__";
const defaultTheme: EmailTemplateTheme = {
  borderColor: "#e8e1d4",
  fontColor: "#484640",
  buttonColor: "#e89a12",
  backgroundColor: "#f7f3ea",
};

export function SettingsPage({ embedded = false }: { embedded?: boolean } = {}) {
  const { configureTopBar, setProfileImageUrl } = useAppShell();
  const [section, setSection] = useState<Section>("General");
  const [settings, setSettings] = useState<ProductSettings | null>(null);
  const [signature, setSignature] = useState<ProductSettings["signature"] | null>(null);
  const [templates, setTemplates] = useState<EmailTemplateOption[]>([]);
  const [templateChoice, setTemplateChoice] = useState("none");
  const [notice, setNotice] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [profileUploading, setProfileUploading] = useState(false);

  const loadTemplates = async () => {
    const catalog = await api.templates();
    setTemplates(catalog.templates);
    setTemplateChoice(catalog.selectedTemplateKey || "none");
  };

  useEffect(() => {
    void Promise.all([api.settings(), api.templates()])
      .then(([value, catalog]) => {
        setSettings(value);
        setSignature(value.signature);
        setTemplates(catalog.templates);
        setTemplateChoice(catalog.selectedTemplateKey || "none");
      })
      .catch((err) => setNotice(err instanceof Error ? err.message : String(err)));
  }, []);
  useEffect(() => { if (!embedded) configureTopBar({ search: "", searchPlaceholder: "Search settings", onSearchChange: () => undefined, onSearch: () => undefined, searchDisabled: true }); }, [configureTopBar, embedded]);

  const wrap = (node: ReactNode) => embedded ? <div className="gsw-embedded-workspace">{node}</div> : <MailWorkspace section="settings">{node}</MailWorkspace>;
  if (!settings || !signature) return wrap(<div className="gsw-product-loading gsw-product-loading-inline">Loading settings...</div>);

  const saveSignature = async () => {
    try {
      const saved = await api.saveSignature(signature);
      setSignature(saved);
      setNotice("Signature saved");
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    }
  };
  const saveSettings = async (body: { general?: Record<string, unknown>; compose?: Record<string, unknown>; contacts?: Record<string, unknown>; ai?: Record<string, unknown> }) => {
    try {
      const saved = await api.updateSettings(body);
      setSettings((current) => current ? { ...current, ...saved } : current);
      setNotice("Settings saved");
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    }
  };
  const uploadProfileImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = "";
    if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type)) {
      setNotice("Profile image must be PNG, JPEG, WEBP, or GIF.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setNotice("Profile image must be 10 MB or smaller.");
      return;
    }
    setProfileUploading(true);
    setNotice("Uploading profile image…");
    try {
      const uploaded = await api.uploadFile(file, { source: "profile", kind: "profile_image" });
      const general = {
        ...settings.general,
        profileImageAssetId: uploaded.asset.id,
      };
      const saved = await api.updateSettings({ general });
      setSettings((current) => current ? { ...current, ...saved } : current);
      const nextUrl = typeof saved.general?.profileImageUrl === "string" ? saved.general.profileImageUrl : "";
      setProfileImageUrl(nextUrl);
      setNotice("Profile image saved");
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setProfileUploading(false);
    }
  };

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

  return wrap(<main className="gsw-settings-layout"><aside className="gsw-settings-nav"><p>Workspace</p>{sections.map((item) => <button key={item} className={section === item ? "active" : ""} onClick={() => setSection(item)}>{item}</button>)}</aside>
    <section className="gsw-settings-content"><div className="gsw-page-heading"><div><p className="gsw-eyebrow">Preferences</p><h1>{section}</h1><p>{section === "Signature" ? "A reusable, editable identity for every message." : section === "Templates" ? "Create a reusable email look that stays consistent across GSW Mail and AI-generated drafts." : "Keep the parts of GSW Mail that make communication feel like yours."}</p></div>{notice && <span className="gsw-save-notice">{notice}</span>}</div>
      {section === "General" && <div className="gsw-settings-card"><label>Timezone<select value={String(settings.general.timezone ?? "America/Detroit")} onChange={(event) => setSettings({ ...settings, general: { ...settings.general, timezone: event.target.value } })}><option>America/Detroit</option><option>America/New_York</option><option>America/Chicago</option><option>UTC</option></select></label><label>Language<select value={String(settings.general.language ?? "en-US")} onChange={(event) => setSettings({ ...settings, general: { ...settings.general, language: event.target.value } })}><option value="en-US">English (US)</option></select></label><label><strong>Profile image</strong><span className="gsw-template-logo-picker">{settings.general.profileImageUrl ? <img src={String(settings.general.profileImageUrl)} alt="Profile" /> : <span>Initials</span>}<span><label className="gsw-secondary-btn">{profileUploading ? "Uploading…" : "Upload image"}<input className="gsw-hidden-input" type="file" accept="image/png,image/jpeg,image/webp,image/gif" disabled={profileUploading} onChange={(event) => void uploadProfileImage(event)} /></label>{Boolean(settings.general.profileImageAssetId) && <button className="gsw-link-btn" type="button" disabled={profileUploading} onClick={() => {
        const general = { ...settings.general, profileImageAssetId: null, profileImageUrl: "" };
        void api.updateSettings({ general }).then((saved) => {
          setSettings((current) => current ? { ...current, ...saved } : current);
          setProfileImageUrl("");
          setNotice("Profile image removed");
        }).catch((err) => setNotice(err instanceof Error ? err.message : String(err)));
      }}>Remove</button>}</span></span><small>Stored privately in GSW Files. PNG, JPEG, WEBP, or GIF. Maximum 10 MB.</small></label><button className="gsw-primary-btn" onClick={() => void saveSettings({ general: settings.general })}>Save general settings</button></div>}
      {section === "Signature" && <div className="gsw-settings-card"><div className="gsw-settings-card-head"><div><h2>Default signature</h2><p>Paste from Gmail, Outlook, Word, a website, or another editor. Unsafe scripts and links are removed.</p></div><label className="gsw-switch"><input type="checkbox" checked={signature.enabled} onChange={(event) => setSignature({ ...signature, enabled: event.target.checked })} /><span>Enabled</span></label></div><RichTextEditor value={signature.signatureHtml} onChange={(value) => setSignature({ ...signature, signatureHtml: value })} placeholder="Write your signature" minHeight={190} /><div className="gsw-option-grid"><label><input type="checkbox" checked={signature.onNew} onChange={(event) => setSignature({ ...signature, onNew: event.target.checked })} /> New messages</label><label><input type="checkbox" checked={signature.onReply} onChange={(event) => setSignature({ ...signature, onReply: event.target.checked })} /> Replies</label><label><input type="checkbox" checked={signature.onForward} onChange={(event) => setSignature({ ...signature, onForward: event.target.checked })} /> Forwards</label><label>Placement<select value={signature.position} onChange={(event) => setSignature({ ...signature, position: event.target.value as ProductSettings["signature"]["position"] })}><option value="beforeQuotedText">Before quoted history</option><option value="afterQuotedText">After quoted history</option></select></label></div><p className="gsw-muted">Plaintext preview: {signature.signatureText || "Your signature text will appear here."}</p><button className="gsw-primary-btn" onClick={() => void saveSignature()}>Save signature</button></div>}
      {section === "Compose" && <div className="gsw-settings-card"><h2>Compose preferences</h2><label className="gsw-setting-row"><span><strong>Rich text by default</strong><small>Keep formatting when pasting into new messages.</small></span><input type="checkbox" checked={settings.compose.defaultFormat !== "plain"} onChange={(event) => setSettings({ ...settings, compose: { ...settings.compose, defaultFormat: event.target.checked ? "rich" : "plain" } })} /></label><button className="gsw-primary-btn" onClick={() => void saveSettings({ compose: settings.compose })}>Save compose settings</button></div>}
      {section === "Contacts" && <div className="gsw-settings-card"><h2>Contact capture</h2><label className="gsw-setting-row"><span><strong>Create contacts from sent mail</strong><small>New recipients become lightweight contacts and existing contacts gain engagement history.</small></span><input type="checkbox" checked={settings.contacts.autoCreateFromSent !== false} onChange={(event) => setSettings({ ...settings, contacts: { ...settings.contacts, autoCreateFromSent: event.target.checked } })} /></label><button className="gsw-secondary-btn gsw-inline-btn" type="button" onClick={() => window.dispatchEvent(new CustomEvent("gsw-workspace-open", { detail: { section: "contacts" } }))}>Open contacts</button><button className="gsw-primary-btn" onClick={() => void saveSettings({ contacts: settings.contacts })}>Save contact settings</button></div>}
      {section === "AI" && <div className="gsw-settings-card"><div className="gsw-settings-card-head"><div><h2>GSW AI capabilities</h2><p>These switches control which capabilities GSW Chat is allowed to request anywhere in the app. Per-chat permissions and confirmations still apply.</p></div><label className="gsw-switch"><input type="checkbox" checked={settings.ai.enabled !== false} onChange={(event) => setSettings({ ...settings, ai: { ...settings.ai, enabled: event.target.checked } })} /><span>AI enabled</span></label></div>
        <label className="gsw-setting-row"><span><strong>Read mail</strong><small>Allow AI to search, read, summarize, and reason over mailbox content.</small></span><input type="checkbox" disabled={settings.ai.enabled === false} checked={settings.ai.mailRead !== false} onChange={(event) => setSettings({ ...settings, ai: { ...settings.ai, mailRead: event.target.checked } })} /></label>
        <label className="gsw-setting-row"><span><strong>Create and edit drafts</strong><small>Allow AI to create and mutate drafts after the user grants mail.write permission.</small></span><input type="checkbox" disabled={settings.ai.enabled === false} checked={settings.ai.draftMutation !== false} onChange={(event) => setSettings({ ...settings, ai: { ...settings.ai, draftMutation: event.target.checked } })} /></label>
        <label className="gsw-setting-row"><span><strong>Send email</strong><small>Allow AI to request email sending. Every interactive send still requires explicit confirmation.</small></span><input type="checkbox" disabled={settings.ai.enabled === false} checked={settings.ai.emailSend !== false} onChange={(event) => setSettings({ ...settings, ai: { ...settings.ai, emailSend: event.target.checked } })} /></label>
        <label className="gsw-setting-row"><span><strong>Files</strong><small>Allow GSW Chat to find and inspect files in your private GSW Files library. First-use file permission still applies.</small></span><input type="checkbox" disabled={settings.ai.enabled === false} checked={settings.ai.fileAccess !== false} onChange={(event) => setSettings({ ...settings, ai: { ...settings.ai, fileAccess: event.target.checked } })} /></label>
        <label className="gsw-setting-row"><span><strong>Image generation</strong><small>Allow GSW Chat to generate new images and save them into your private GSW Files library.</small></span><input type="checkbox" disabled={settings.ai.enabled === false} checked={settings.ai.imageGeneration !== false} onChange={(event) => setSettings({ ...settings, ai: { ...settings.ai, imageGeneration: event.target.checked } })} /></label>
        <label className="gsw-setting-row"><span><strong>Scheduled work</strong><small>Allow GSW Chat to create and manage durable background tasks.</small></span><input type="checkbox" disabled={settings.ai.enabled === false} checked={settings.ai.scheduledWork !== false} onChange={(event) => setSettings({ ...settings, ai: { ...settings.ai, scheduledWork: event.target.checked } })} /></label>
        <label className="gsw-setting-row"><span><strong>Campaign coordination and launch</strong><small>Allow AI to build audiences from contact tags, prepare campaigns, and request a confirmed campaign launch.</small></span><input type="checkbox" disabled={settings.ai.enabled === false} checked={settings.ai.campaignLaunch !== false} onChange={(event) => setSettings({ ...settings, ai: { ...settings.ai, campaignLaunch: event.target.checked } })} /></label>
        <p className="gsw-muted">Turning a capability off here removes it globally from the AI toolset. Turning it on does not silently grant access; GSW Chat still asks for the matching permission when needed.</p>
        <button className="gsw-primary-btn" onClick={() => void saveSettings({ ai: settings.ai })}>Save AI settings</button>
      </div>}
      {section === "Templates" && <TemplateSettings
        templates={templates}
        selectedKey={templateChoice}
        onSelected={(key) => {
          setTemplateChoice(key);
          setSettings((current) => current ? { ...current, general: { ...current.general, templateKey: key } } : current);
        }}
        onReload={() => loadTemplates()}
        onNotice={setNotice}
      />}
      <footer className="gsw-settings-legal-footer"><a href="/privacy">Privacy Policy</a><a href="/terms">Terms of Service</a><button type="button" className="gsw-settings-text-button danger" onClick={() => setShowDeleteConfirm((value) => !value)}>Delete account</button></footer>
      {showDeleteConfirm && <div className="gsw-delete-confirm"><p><strong>Delete your GSW Mail account?</strong></p><p>This removes your sign-in profile and personal GSW Mail settings. Organization-owned mailbox data or records may be retained as described in the Privacy Policy. This action cannot be undone.</p><div className="gsw-delete-confirm-actions"><button className="gsw-danger-btn" disabled={deleteBusy} onClick={() => void deleteAccount()}>{deleteBusy ? "Starting deletion…" : "Yes, delete my account"}</button><button className="gsw-secondary-btn" disabled={deleteBusy} onClick={() => setShowDeleteConfirm(false)}>Cancel</button></div></div>}
    </section></main>);
}

function TemplateSettings({
  templates,
  selectedKey,
  onSelected,
  onReload,
  onNotice,
}: {
  templates: EmailTemplateOption[];
  selectedKey: string;
  onSelected: (key: string) => void;
  onReload: () => Promise<void>;
  onNotice: (value: string) => void;
}) {
  const [builderMode, setBuilderMode] = useState<"create" | "edit" | null>(null);
  const [editing, setEditing] = useState<EmailTemplateOption | null>(null);
  const selected = useMemo(() => templates.find((template) => template.key === selectedKey) ?? templates.find((template) => template.key === "none") ?? null, [templates, selectedKey]);

  const choose = async (value: string) => {
    if (value === CREATE_TEMPLATE_KEY) {
      setEditing(null);
      setBuilderMode("create");
      return;
    }
    setBuilderMode(null);
    setEditing(null);
    try {
      await api.selectTemplate(value);
      onSelected(value);
      onNotice("Default template saved");
    } catch (err) {
      onNotice(err instanceof Error ? err.message : String(err));
    }
  };

  if (builderMode) {
    return <TemplateBuilder
      mode={builderMode}
      template={editing}
      onCancel={() => { setBuilderMode(null); setEditing(null); }}
      onSaved={async (template) => {
        await api.selectTemplate(template.key);
        onSelected(template.key);
        await onReload();
        setBuilderMode(null);
        setEditing(null);
        onNotice("Template saved and selected");
      }}
      onNotice={onNotice}
    />;
  }

  return <div className="gsw-settings-card gsw-template-settings-card">
    <div>
      <h2>Default email template</h2>
      <p>Select a saved design or create a new one. Your selected template is used by compose, GSW Chat drafts, and campaign sends.</p>
    </div>
    <label>Template
      <select value={selectedKey} onChange={(event) => void choose(event.target.value)}>
        {templates.map((template) => <option key={template.key} value={template.key}>{template.name}</option>)}
        <option value={CREATE_TEMPLATE_KEY}>Create New…</option>
      </select>
    </label>
    {selected && selected.key !== "none" && <TemplatePreview template={selected} />}
    <div className="gsw-template-actions">
      {selected?.editable && <button className="gsw-secondary-btn" type="button" onClick={() => { setEditing(selected); setBuilderMode("edit"); }}>Edit template</button>}
      {selected?.editable && selected.id && <button className="gsw-settings-text-button danger" type="button" onClick={() => {
        if (!window.confirm(`Delete “${selected.name}”?`)) return;
        void api.deleteTemplate(selected.id!).then(async () => {
          await api.selectTemplate("none");
          onSelected("none");
          await onReload();
          onNotice("Template deleted");
        }).catch((err) => onNotice(err instanceof Error ? err.message : String(err)));
      }}>Delete template</button>}
    </div>
  </div>;
}

function TemplateBuilder({
  mode,
  template,
  onCancel,
  onSaved,
  onNotice,
}: {
  mode: "create" | "edit";
  template: EmailTemplateOption | null;
  onCancel: () => void;
  onSaved: (template: EmailTemplateOption) => Promise<void>;
  onNotice: (value: string) => void;
}) {
  const initialTheme = template?.theme ?? defaultTheme;
  const [name, setName] = useState(template?.name ?? "");
  const [theme, setTheme] = useState<EmailTemplateTheme>({ ...initialTheme });
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(template?.logoUrl ?? null);
  const [logoFilename, setLogoFilename] = useState<string | null>(template?.logoFilename ?? null);
  const [logoAssetId, setLogoAssetId] = useState<string | null>(template?.logoAssetId ?? null);
  const [logoChanged, setLogoChanged] = useState(false);
  const [logoUploading, setLogoUploading] = useState(false);
  const [busy, setBusy] = useState(false);

  const updateColor = (field: keyof EmailTemplateTheme, value: string) => setTheme((current) => ({ ...current, [field]: value }));
  const uploadLogo = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = "";
    if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type)) {
      onNotice("Logo must be PNG, JPEG, WEBP, or GIF.");
      return;
    }
    if (file.size > 1024 * 1024) {
      onNotice("Logo must be 1 MB or smaller.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setLogoDataUrl(typeof reader.result === "string" ? reader.result : null);
    reader.readAsDataURL(file);
    setLogoUploading(true);
    onNotice("Uploading logo…");
    try {
      const uploaded = await api.uploadFile(file, { source: "template", kind: "template_asset" });
      setLogoAssetId(uploaded.asset.id);
      setLogoFilename(file.name);
      setLogoChanged(true);
      onNotice("Logo uploaded");
    } catch (err) {
      onNotice(err instanceof Error ? err.message : String(err));
      setLogoDataUrl(template?.logoUrl ?? null);
    } finally {
      setLogoUploading(false);
    }
  };

  const save = async () => {
    if (!name.trim()) {
      onNotice("Template name is required.");
      return;
    }
    setBusy(true);
    try {
      const body: EmailTemplateInput = {
        name: name.trim(),
        ...theme,
        ...(logoChanged ? { logoAssetId, logoFilename, logoDataUrl: null } : {}),
      };
      const result = mode === "edit" && template?.id
        ? await api.updateTemplate(template.id, body)
        : await api.createTemplate(body);
      await onSaved(result.template);
    } catch (err) {
      onNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const previewTemplate: EmailTemplateOption = {
    ...(template?.id ? { id: template.id } : {}),
    key: template?.key ?? "preview",
    name: name.trim() || "Your Template",
    kind: "custom",
    editable: true,
    theme,
    logoUrl: logoDataUrl,
    logoFilename,
  };

  return <div className="gsw-settings-card gsw-template-builder">
    <div className="gsw-settings-card-head"><div><h2>{mode === "create" ? "Create email template" : "Edit email template"}</h2><p>Keep the structure simple, then let your brand show through the logo and colors.</p></div><button className="gsw-secondary-btn" type="button" onClick={onCancel}>Cancel</button></div>
    <div className="gsw-template-builder-grid">
      <div className="gsw-template-controls">
        <label><strong>Template name</strong><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Customer outreach" maxLength={120} required /></label>
        <label><strong>Logo</strong><span className="gsw-template-logo-picker">{logoDataUrl ? <img src={logoDataUrl} alt="" /> : <span>No logo</span>}<span><label className="gsw-secondary-btn">{logoUploading ? "Uploading…" : "Upload logo"}<input className="gsw-hidden-input" type="file" accept="image/png,image/jpeg,image/webp,image/gif" disabled={logoUploading} onChange={(event) => void uploadLogo(event)} /></label>{logoDataUrl && <button className="gsw-link-btn" type="button" onClick={() => { setLogoDataUrl(null); setLogoFilename(null); setLogoAssetId(null); setLogoChanged(true); }}>Remove</button>}</span></span><small>PNG, JPEG, WEBP, or GIF. Maximum 1 MB.</small></label>
        <ColorField label="Border" value={theme.borderColor} onChange={(value) => updateColor("borderColor", value)} />
        <ColorField label="Font" value={theme.fontColor} onChange={(value) => updateColor("fontColor", value)} />
        <ColorField label="Buttons & links" value={theme.buttonColor} onChange={(value) => updateColor("buttonColor", value)} />
        <ColorField label="Background" value={theme.backgroundColor} onChange={(value) => updateColor("backgroundColor", value)} />
      </div>
      <div className="gsw-template-preview-column"><span className="gsw-eyebrow">Responsive preview</span><TemplatePreview template={previewTemplate} /></div>
    </div>
    <button className="gsw-primary-btn" disabled={busy || logoUploading || !name.trim()} onClick={() => void save()}>{busy ? "Saving…" : logoUploading ? "Uploading logo…" : "Save Template"}</button>
  </div>;
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="gsw-template-color-field"><strong>{label}</strong><span><input type="color" value={value} onChange={(event) => onChange(event.target.value)} /><input value={value} onChange={(event) => onChange(event.target.value)} maxLength={7} /></span></label>;
}

function TemplatePreview({ template }: { template: EmailTemplateOption }) {
  if (template.key === "none") return null;
  const theme = template.theme ?? defaultTheme;
  return <div className="gsw-template-preview-stage" style={{ background: theme.backgroundColor }}>
    <div className="gsw-template-preview-email" style={{ borderColor: theme.borderColor, color: theme.fontColor }}>
      <header style={{ borderBottomColor: theme.borderColor }}>
        {template.logoUrl ? <img src={template.logoUrl} alt="" /> : <span className="gsw-template-preview-placeholder-logo">G</span>}
        <strong>{template.name}</strong>
      </header>
      <div className="gsw-template-preview-body">
        <p>Hi Taylor,</p>
        <p>This is how your message will look inside GSW Mail. Your real email content and signature will appear here when you send.</p>
        <a href="#preview" onClick={(event) => event.preventDefault()} style={{ background: theme.buttonColor }}>Example button</a>
        <p>Best,<br />Your team</p>
      </div>
    </div>
  </div>;
}
