import { useEffect, useMemo, useState, type ChangeEvent, type ReactNode } from "react";
import { X } from "lucide-react";
import { api, type Contact } from "../api";
import { useAppShell } from "../components/AppShell";
import { MailWorkspace } from "../components/MailWorkspace";

type ImportState = { filename: string; headers: string[]; rows: Record<string, string>[]; mapping: Record<string, string> } | null;
type FailedRow = { rowNumber: number; raw: Record<string, string>; error?: string | null };
const fields = ["ignore", "firstName", "middleName", "lastName", "displayName", "organization", "jobTitle", "website", "address", "city", "state", "postalCode", "country", "notes", "email", "phone", "tags"];
const pageSize = 100;

export function ContactsPage({ embedded = false }: { embedded?: boolean } = {}) {
  const { configureTopBar } = useAppShell();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [totalContacts, setTotalContacts] = useState(0);
  const [page, setPage] = useState(0);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Contact | null>(null);
  const [imports, setImports] = useState<Awaited<ReturnType<typeof api.contactImports>>["imports"]>([]);
  const [importState, setImportState] = useState<ImportState>(null);
  const [duplicateBehavior, setDuplicateBehavior] = useState("merge");
  const [notice, setNotice] = useState("");
  const [failedRows, setFailedRows] = useState<FailedRow[] | null>(null);
  const [newContact, setNewContact] = useState(false);
  const [form, setForm] = useState({ displayName: "", email: "", organization: "", jobTitle: "", tags: "", notes: "" });

  const load = () => {
    void api.contactsPage(query, pageSize, page * pageSize)
      .then((value) => {
        setContacts(value.contacts);
        setTotalContacts(value.total);
      })
      .catch((err) => setNotice(err instanceof Error ? err.message : String(err)));
    void api.contactImports().then((value) => setImports(value.imports)).catch(() => undefined);
  };

  useEffect(() => { setPage(0); }, [query]);
  useEffect(() => { load(); }, [query, page]);
  useEffect(() => { if (!embedded) configureTopBar({ search: query, searchPlaceholder: "Search contacts", onSearchChange: setQuery, onSearch: () => undefined, searchDisabled: false }); }, [configureTopBar, query, embedded]);

  const title = useMemo(() => totalContacts === 1 ? "1 contact" : `${totalContacts} contacts`, [totalContacts]);
  const parseFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const parsed = parseCsv(text);
    const mapping = Object.fromEntries(parsed.headers.map((header) => [header, guessField(header)]));
    setImportState({ filename: file.name, headers: parsed.headers, rows: parsed.rows, mapping });
  };
  const runImport = async () => {
    if (!importState) return;
    try {
      const result = await api.importContacts({ ...importState, duplicateBehavior });
      setNotice(`Processed ${result.rowCount}: ${result.createdCount} created, ${result.updatedCount} updated, ${result.skippedCount} skipped, ${result.duplicateCount} duplicates, ${result.failedCount} failed.`);
      setImportState(null);
      setPage(0);
      load();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    }
  };
  const create = async () => {
    try {
      const contact = await api.createContact({ displayName: form.displayName, emails: [{ email: form.email }], organization: form.organization, jobTitle: form.jobTitle, tags: form.tags.split(",").map((tag) => tag.trim()).filter(Boolean), notes: form.notes });
      setSelected(contact);
      setNewContact(false);
      setForm({ displayName: "", email: "", organization: "", jobTitle: "", tags: "", notes: "" });
      load();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    }
  };

  const wrap = (node: ReactNode) => embedded ? <div className="gsw-embedded-workspace gsw-embedded-contacts">{node}</div> : <MailWorkspace section="contacts">{node}</MailWorkspace>;
  return wrap(<><div className="gsw-product-shell"><main className="gsw-contacts-page">
      <div className="gsw-page-heading">
        <div><p className="gsw-eyebrow">People you reach</p><h1>Contacts</h1><p>Useful relationship context, not a CRM. {title}.</p></div>
        <div className="gsw-page-actions"><label className="gsw-secondary-btn">Import CSV<input className="gsw-hidden-input" type="file" accept=".csv,text/csv" onChange={(event) => void parseFile(event)} /></label><button className="gsw-primary-btn" onClick={() => setNewContact(true)}>New contact</button></div>
      </div>
      {notice && <p className="gsw-save-notice">{notice}</p>}
      <div className="gsw-contacts-toolbar"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, email, organization, title, or tag" /><span>Ranked by match, recency, and frequency</span></div>
      <div className="gsw-contacts-grid">
        <section className="gsw-contact-list">{contacts.length ? contacts.map((contact) => <button className="gsw-contact-row" key={contact.id} onClick={() => setSelected(contact)}><span className="gsw-contact-avatar">{(contact.displayName || "?").slice(0, 1).toUpperCase()}</span><span><strong>{contact.displayName || contact.emails[0]?.email}</strong><small>{contact.jobTitle || contact.organization || contact.emails[0]?.email}</small><em>{contact.emails[0]?.email}</em></span><b>{contact.timesEmailed ? `${contact.timesEmailed} sent` : "New"}</b></button>) : <div className="gsw-empty-product"><strong>No contacts yet</strong><p>Send an email or import a list to start building your address book.</p></div>}</section>
        <aside className="gsw-import-history"><h2>Import history</h2>{imports.length ? imports.map((item) => <div key={item.id}><strong>{item.filename}</strong><span>{item.createdCount} new · {item.updatedCount} updated · {item.skippedCount} skipped · {item.duplicateCount} duplicates · {item.failedCount} failed</span><small>{new Date(item.createdAt).toLocaleDateString()}</small>{item.failedCount > 0 && <button className="gsw-link-btn" onClick={() => void api.contactImportRows(item.id).then((value) => setFailedRows(value.rows.filter((row) => row.status === "failed"))).catch(() => undefined)}>View failed rows</button>}</div>) : <p>No imports yet.</p>}</aside>
      </div>
      <div className="gsw-contact-pagination"><span>Showing {totalContacts === 0 ? 0 : page * pageSize + 1}–{Math.min((page + 1) * pageSize, totalContacts)} of {totalContacts}</span><div><button className="gsw-secondary-btn" disabled={page === 0} onClick={() => setPage((current) => Math.max(0, current - 1))}>Previous</button><button className="gsw-secondary-btn" disabled={(page + 1) * pageSize >= totalContacts} onClick={() => setPage((current) => current + 1)}>Next</button></div></div>
    </main></div>
    {selected && <ContactDrawer contact={selected} onClose={() => setSelected(null)} onSaved={(value) => { setSelected(value); load(); }} />}
    {newContact && <div className="gsw-drawer-backdrop"><section className="gsw-contact-drawer"><button className="gsw-drawer-close" onClick={() => setNewContact(false)} aria-label="Close new contact"><X size={18} strokeWidth={1.75} aria-hidden="true" /></button><p className="gsw-eyebrow">Address book</p><h2>New contact</h2><div className="gsw-contact-form"><input placeholder="Name" value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} /><input placeholder="Email" type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /><input placeholder="Organization" value={form.organization} onChange={(event) => setForm({ ...form, organization: event.target.value })} /><input placeholder="Job title" value={form.jobTitle} onChange={(event) => setForm({ ...form, jobTitle: event.target.value })} /><input placeholder="Tags, separated by commas" value={form.tags} onChange={(event) => setForm({ ...form, tags: event.target.value })} /><textarea placeholder="Notes" value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /><button className="gsw-primary-btn" onClick={() => void create()}>Create contact</button></div></section></div>}
    {failedRows && <div className="gsw-modal-backdrop"><section className="gsw-import-modal"><div className="gsw-page-heading"><div><p className="gsw-eyebrow">Import review</p><h2>Failed rows</h2><p>{failedRows.length} rows need attention.</p></div><button className="gsw-drawer-close" onClick={() => setFailedRows(null)} aria-label="Close failed rows"><X size={18} strokeWidth={1.75} aria-hidden="true" /></button></div>{failedRows.map((row) => <div className="gsw-import-preview" key={row.rowNumber}><strong>Row {row.rowNumber}</strong><p>{row.error}</p><p>{Object.values(row.raw).join(" · ")}</p></div>)}</section></div>}
    {importState && <div className="gsw-modal-backdrop"><section className="gsw-import-modal"><div className="gsw-page-heading"><div><p className="gsw-eyebrow">Step 2 of 2</p><h2>Map CSV columns</h2><p>{importState.filename} · {importState.rows.length} rows detected</p></div><button className="gsw-drawer-close" onClick={() => setImportState(null)} aria-label="Close import mapping"><X size={18} strokeWidth={1.75} aria-hidden="true" /></button></div><div className="gsw-import-mapping">{importState.headers.map((header) => <label key={header}><span>{header}</span><select value={importState.mapping[header]} onChange={(event) => setImportState({ ...importState, mapping: { ...importState.mapping, [header]: event.target.value } })}>{fields.map((field) => <option key={field} value={field}>{field === "ignore" ? "Leave as custom field" : field}</option>)}</select></label>)}</div><div className="gsw-import-preview"><strong>Preview</strong><div>{importState.rows.slice(0, 3).map((row, index) => <p key={index}>{Object.values(row).join(" · ")}</p>)}</div></div><label className="gsw-duplicate-choice">Duplicates<select value={duplicateBehavior} onChange={(event) => setDuplicateBehavior(event.target.value)}><option value="merge">Merge missing fields (safest)</option><option value="skip">Skip</option><option value="overwrite">Overwrite mapped fields</option></select></label><button className="gsw-primary-btn" onClick={() => void runImport()}>Import {importState.rows.length} rows</button></section></div>}
   </>);
}

function ContactDrawer({ contact, onClose, onSaved }: { contact: Contact; onClose: () => void; onSaved: (contact: Contact) => void }) {
  const [displayName, setDisplayName] = useState(contact.displayName ?? "");
  const [organization, setOrganization] = useState(contact.organization ?? "");
  const [jobTitle, setJobTitle] = useState(contact.jobTitle ?? "");
  const [website, setWebsite] = useState(contact.website ?? "");
  const [emails, setEmails] = useState(contact.emails.map((item) => ({ ...item })));
  const [phones, setPhones] = useState(contact.phones.map((item) => ({ ...item })));
  const [tags, setTags] = useState<string[]>(contact.tags);
  const [tagDraft, setTagDraft] = useState("");
  const [notes, setNotes] = useState(contact.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setDisplayName(contact.displayName ?? "");
    setOrganization(contact.organization ?? "");
    setJobTitle(contact.jobTitle ?? "");
    setWebsite(contact.website ?? "");
    setEmails(contact.emails.map((item) => ({ ...item })));
    setPhones(contact.phones.map((item) => ({ ...item })));
    setTags(contact.tags);
    setTagDraft("");
    setNotes(contact.notes ?? "");
    setError("");
  }, [contact]);

  const commitTag = (raw = tagDraft) => {
    const next = raw.trim().replace(/^#/, "");
    if (!next) return;
    setTags((current) => current.some((tag) => tag.toLowerCase() === next.toLowerCase()) ? current : [...current, next]);
    setTagDraft("");
  };

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const normalizedEmails = emails
        .map((item, index) => ({ email: item.email.trim(), label: item.label ?? undefined, isPrimary: item.isPrimary || index === 0 }))
        .filter((item) => item.email);
      if (!normalizedEmails.length) throw new Error("A contact needs at least one email address.");
      const saved = await api.updateContact(contact.id, {
        firstName: contact.firstName ?? undefined,
        middleName: contact.middleName ?? undefined,
        lastName: contact.lastName ?? undefined,
        displayName: displayName.trim() || normalizedEmails[0]!.email,
        organization: organization.trim() || undefined,
        jobTitle: jobTitle.trim() || undefined,
        website: website.trim() || undefined,
        address: contact.address ?? undefined,
        city: contact.city ?? undefined,
        state: contact.state ?? undefined,
        postalCode: contact.postalCode ?? undefined,
        country: contact.country ?? undefined,
        notes,
        emails: normalizedEmails,
        phones: phones.map((item, index) => ({ phone: item.phone.trim(), label: item.label ?? undefined, isPrimary: item.isPrimary || index === 0 })).filter((item) => item.phone),
        tags,
        customFields: contact.customFields,
      });
      onSaved(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return <div className="gsw-drawer-backdrop"><section className="gsw-contact-drawer gsw-contact-drawer-editable">
    <button className="gsw-drawer-close" onClick={onClose} aria-label="Close contact"><X size={18} strokeWidth={1.75} aria-hidden="true" /></button>
    <span className="gsw-contact-avatar gsw-contact-avatar-large">{(displayName || emails[0]?.email || "?").slice(0, 1).toUpperCase()}</span>
    <div className="gsw-contact-edit-grid">
      <label><strong>Name</strong><input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Contact name" /></label>
      <label><strong>Organization</strong><input value={organization} onChange={(event) => setOrganization(event.target.value)} placeholder="Organization" /></label>
      <label><strong>Job title</strong><input value={jobTitle} onChange={(event) => setJobTitle(event.target.value)} placeholder="Job title" /></label>
      <label><strong>Website</strong><input value={website} onChange={(event) => setWebsite(event.target.value)} placeholder="https://..." /></label>
    </div>

    <div className="gsw-detail-block gsw-contact-edit-list">
      <div className="gsw-contact-edit-list-head"><strong>Email addresses</strong><button type="button" className="gsw-link-btn" onClick={() => setEmails((current) => [...current, { email: "", normalizedEmail: "", label: null, isPrimary: current.length === 0 }])}>+ Add email</button></div>
      {emails.map((item, index) => <div className="gsw-contact-edit-row" key={`${index}-${item.normalizedEmail}`}>
        <input type="email" value={item.email} placeholder="name@example.com" onChange={(event) => setEmails((current) => current.map((email, emailIndex) => emailIndex === index ? { ...email, email: event.target.value } : email))} />
        <button type="button" className="gsw-contact-remove" disabled={emails.length <= 1} onClick={() => setEmails((current) => current.filter((_, emailIndex) => emailIndex !== index))}>Remove</button>
      </div>)}
    </div>

    <div className="gsw-detail-block gsw-contact-edit-list">
      <div className="gsw-contact-edit-list-head"><strong>Phone numbers</strong><button type="button" className="gsw-link-btn" onClick={() => setPhones((current) => [...current, { phone: "", label: null, isPrimary: current.length === 0 }])}>+ Add phone</button></div>
      {phones.length ? phones.map((item, index) => <div className="gsw-contact-edit-row" key={`${index}-${item.phone}`}>
        <input value={item.phone} placeholder="Phone number" onChange={(event) => setPhones((current) => current.map((phone, phoneIndex) => phoneIndex === index ? { ...phone, phone: event.target.value } : phone))} />
        <button type="button" className="gsw-contact-remove" onClick={() => setPhones((current) => current.filter((_, phoneIndex) => phoneIndex !== index))}>Remove</button>
      </div>) : <small>No phone numbers</small>}
    </div>

    <div className="gsw-detail-block">
      <strong>Tags</strong>
      <div className="gsw-tag-list gsw-tag-list-editable">
        {tags.map((tag) => <button type="button" key={tag} onClick={() => setTags((current) => current.filter((value) => value !== tag))} title="Remove tag">{tag}<span>×</span></button>)}
      </div>
      <div className="gsw-contact-tag-entry">
        <input value={tagDraft} onChange={(event) => setTagDraft(event.target.value)} placeholder="Add a tag, e.g. customer" onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === ",") {
            event.preventDefault();
            commitTag();
          }
        }} />
        <button type="button" className="gsw-secondary-btn" onClick={() => commitTag()}>Add tag</button>
      </div>
      <small>Tags are available to GSW Chat for audience targeting, such as “email all contacts tagged customer.”</small>
    </div>

    <label className="gsw-detail-block"><strong>Notes</strong><textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Add context you want GSW Chat to remember about this contact" /></label>
    <div className="gsw-engagement"><span><strong>Last emailed</strong>{contact.lastContactedAt ? new Date(contact.lastContactedAt).toLocaleDateString() : "Never"}</span><span><strong>Times emailed</strong>{contact.timesEmailed}</span></div>
    {error && <p className="gsw-save-notice">{error}</p>}
    <button className="gsw-primary-btn" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save contact"}</button>
  </section></div>;
}

function guessField(header: string) { const value = header.toLowerCase().replace(/[^a-z]/g, ""); if (value.includes("email")) return "email"; if (value.includes("phone") || value.includes("mobile")) return "phone"; if (value.includes("first")) return "firstName"; if (value.includes("last")) return "lastName"; if (value.includes("church") || value.includes("company") || value.includes("organization") || value.includes("ministry")) return "organization"; if (value.includes("title") || value.includes("role")) return "jobTitle"; if (value.includes("city")) return "city"; if (value.includes("state") || value.includes("region")) return "state"; if (value.includes("note")) return "notes"; return "ignore"; }
function parseCsv(input: string) { const rows: string[][] = []; let row: string[] = []; let cell = ""; let quoted = false; for (let index = 0; index < input.length; index += 1) { const char = input[index]; const next = input[index + 1]; if (char === '"' && quoted && next === '"') { cell += '"'; index += 1; } else if (char === '"') quoted = !quoted; else if (char === "," && !quoted) { row.push(cell); cell = ""; } else if ((char === "\n" || char === "\r") && !quoted) { if (char === "\r" && next === "\n") index += 1; row.push(cell); if (row.some(Boolean)) rows.push(row); row = []; cell = ""; } else cell += char; } if (cell || row.length) { row.push(cell); rows.push(row); } const headers = rows.shift()?.map((header) => header.trim()).filter(Boolean) ?? []; return { headers, rows: rows.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]))) }; }
