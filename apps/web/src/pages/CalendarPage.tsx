import { useEffect, useState } from "react";
import { api, type CalendarEvent } from "../api";
import { useAppShell } from "../components/AppShell";
import { MailWorkspace } from "../components/MailWorkspace";

const monthStart = (date: Date) => new Date(date.getFullYear(), date.getMonth(), 1);
const monthEnd = (date: Date) => new Date(date.getFullYear(), date.getMonth() + 1, 1);
type EventForm = { calendarId: string; title: string; description: string; start: string; durationMinutes: string; location: string; meetingLink: string; attendees: string; sendInvitations: boolean; allDay: boolean };
const localInput = (value: string) => { const date = new Date(value); if (Number.isNaN(date.getTime())) return value.slice(0, 16); const offset = date.getTimezoneOffset() * 60_000; return new Date(date.getTime() - offset).toISOString().slice(0, 16); };
const blankForm = (calendarId = ""): EventForm => ({ calendarId, title: "", description: "", start: localInput(new Date().toISOString()), durationMinutes: "60", location: "", meetingLink: "", attendees: "", sendInvitations: true, allDay: false });

export function CalendarPage() {
  const { account, configureTopBar } = useAppShell();
  const [month, setMonth] = useState(() => monthStart(new Date()));
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [calendars, setCalendars] = useState<Awaited<ReturnType<typeof api.calendars>>["calendars"]>([]);
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<EventForm>(blankForm);
  const [saving, setSaving] = useState(false);

  useEffect(() => { configureTopBar({ search: "", searchPlaceholder: "Search mail", searchDisabled: true }); }, [configureTopBar]);
  useEffect(() => {
    if (!account) return;
    const after = monthStart(month).toISOString();
    const before = monthEnd(month).toISOString();
    void Promise.all([api.calendars(account.id), api.calendarEvents(account.id, after, before)]).then(([calendarResult, eventResult]) => {
      setCalendars(calendarResult.calendars);
      setForm((current) => current.calendarId ? current : { ...current, calendarId: calendarResult.calendars.find((calendar) => calendar.isDefault)?.engineId ?? calendarResult.calendars[0]?.engineId ?? "" });
      setEvents(eventResult.events.sort((a, b) => a.start.localeCompare(b.start)));
      setError("");
    }).catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [account, month]);

  const openNew = () => { setEditingId(null); setFormOpen(true); setForm(blankForm(calendars.find((calendar) => calendar.isDefault)?.engineId ?? calendars[0]?.engineId ?? "")); };
  const openEdit = (event: CalendarEvent) => {
    const duration = event.end ? Math.max(1, Math.round((new Date(event.end).getTime() - new Date(event.start).getTime()) / 60_000)) : 60;
    setEditingId(event.engineId);
    setFormOpen(true);
    setForm({ calendarId: event.calendarIds[0] ?? calendars[0]?.engineId ?? "", title: event.title, description: event.description ?? "", start: localInput(event.start), durationMinutes: String(duration), location: event.location ?? "", meetingLink: event.meetingLink ?? "", attendees: event.attendees.join(", "), sendInvitations: false, allDay: event.allDay });
  };
  const save = async () => {
    if (!account || !form.calendarId || !form.title.trim()) return;
    setSaving(true);
    try {
      const attendees = [...new Set(form.attendees.split(/[;,\s]+/).map((email) => email.trim().toLowerCase()).filter(Boolean))];
      if (attendees.some((email) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) { setError("Enter valid attendee email addresses."); return; }
      const sendSchedulingMessages = form.sendInvitations && attendees.length > 0;
      if (sendSchedulingMessages && !window.confirm(`Send a calendar invitation email to ${attendees.join(", ")}?`)) return;
      const body = { accountId: account.id, calendarId: form.calendarId, title: form.title.trim(), description: form.description || undefined, start: form.start, durationMinutes: Math.max(1, Number(form.durationMinutes) || 60), location: form.location || undefined, meetingLink: form.meetingLink || undefined, attendees, sendSchedulingMessages, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, allDay: form.allDay };
      if (editingId) await api.updateCalendarEvent(editingId, body); else await api.createCalendarEvent(body);
      setEditingId(null);
      setFormOpen(false);
      const after = monthStart(month).toISOString();
      const before = monthEnd(month).toISOString();
      setEvents((await api.calendarEvents(account.id, after, before)).events.sort((a, b) => a.start.localeCompare(b.start)));
      setError("");
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setSaving(false); }
  };
  const remove = async (event: CalendarEvent) => {
    if (!account || !window.confirm(`Delete "${event.title}"?`)) return;
    try { await api.deleteCalendarEvent(event.engineId, account.id); setEvents((current) => current.filter((item) => item.engineId !== event.engineId)); } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  };

  return <MailWorkspace section="calendar"><div className="gsw-product-shell"><main className="gsw-calendar-page">
      <div className="gsw-page-heading"><div><p className="gsw-eyebrow">Connected to {account?.address ?? "your mailbox"}</p><h1>Calendar</h1><p>Events from the calendars connected to this Stalwart account.</p></div><div className="gsw-calendar-controls"><button className="gsw-secondary-btn" onClick={() => setMonth((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))}>Previous</button><strong>{month.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</strong><button className="gsw-secondary-btn" onClick={() => setMonth((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))}>Next</button><button className="gsw-primary-btn" onClick={openNew}>New event</button></div></div>
      {error && <p className="gsw-errors">{error}</p>}
      <div className="gsw-calendar-layout"><aside className="gsw-calendar-list"><h2>Calendars</h2>{calendars.length ? calendars.map((calendar) => <div key={calendar.engineId}><span className="gsw-calendar-dot" style={{ background: calendar.color ?? "var(--gsw-accent)" }} />{calendar.name}</div>) : <p>No calendars available.</p>}</aside><section className="gsw-event-list">{events.length ? events.map((event) => <article className="gsw-calendar-event" key={event.engineId} onClick={() => openEdit(event)}><time>{event.allDay ? "All day" : new Date(event.start).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time><div><h2>{event.title}</h2>{event.meetingLink && <p><a href={event.meetingLink} target="_blank" rel="noreferrer" onClick={(click) => click.stopPropagation()}>Join virtual meeting</a></p>}{event.attendees.length > 0 && <p>{event.attendees.length} invitee{event.attendees.length === 1 ? "" : "s"}</p>}{event.location && <p>{event.location}</p>}{event.description && <p>{event.description}</p>}</div><button className="gsw-link-btn" onClick={(click) => { click.stopPropagation(); void remove(event); }}>Delete</button></article>) : <div className="gsw-empty-product"><strong>No events this month</strong><p>Your Stalwart calendars have no events in this range.</p></div>}</section></div>
      {formOpen && <div className="gsw-calendar-form"><div className="gsw-page-heading"><div><p className="gsw-eyebrow">{editingId ? "Update event" : "New event"}</p><h2>{editingId ? "Edit calendar event" : "Create calendar event"}</h2></div><button className="gsw-secondary-btn" onClick={() => setFormOpen(false)}>Close</button></div><div className="gsw-calendar-form-grid"><label>Calendar<select value={form.calendarId} onChange={(event) => setForm({ ...form, calendarId: event.target.value })}>{calendars.map((calendar) => <option key={calendar.engineId} value={calendar.engineId}>{calendar.name}</option>)}</select></label><label>Title<input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Event title" /></label><label>Starts<input type="datetime-local" value={form.start} onChange={(event) => setForm({ ...form, start: event.target.value })} /></label><label>Duration (minutes)<input type="number" min="1" value={form.durationMinutes} onChange={(event) => setForm({ ...form, durationMinutes: event.target.value })} /></label><label>Location<input value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} /></label><label>Virtual meeting link<input type="url" value={form.meetingLink} onChange={(event) => setForm({ ...form, meetingLink: event.target.value })} placeholder="https://meet.example.com/..." /></label><label>Invite attendees<input value={form.attendees} onChange={(event) => setForm({ ...form, attendees: event.target.value })} placeholder="person@example.com, guest@example.com" /><small>Attendees receive an email invitation only after confirmation.</small></label><label className="gsw-calendar-all-day"><input type="checkbox" checked={form.allDay} onChange={(event) => setForm({ ...form, allDay: event.target.checked })} /> All day</label></div><label>Description<textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /><label className="gsw-calendar-invitations"><input type="checkbox" checked={form.sendInvitations} onChange={(event) => setForm({ ...form, sendInvitations: event.target.checked })} /> Send calendar invitation emails after confirmation</label><button className="gsw-primary-btn" disabled={saving || !form.calendarId || !form.title.trim()} onClick={() => void save()}>{saving ? "Saving..." : editingId ? "Save changes" : "Create event"}</button></label></div>}
    </main></div></MailWorkspace>;
}
