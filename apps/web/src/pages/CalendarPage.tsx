import { useEffect, useRef, useState } from "react";
import { ExternalLink, Mail, Pencil, Plus, Trash2 } from "lucide-react";
import { api, type CalendarEvent } from "../api";
import { useAppShell } from "../components/AppShell";
import { CalendarEventSkeleton } from "../components/LoadingSkeletons";
import { MailWorkspace } from "../components/MailWorkspace";

const monthStart = (date: Date) => new Date(date.getFullYear(), date.getMonth(), 1);
type EventForm = { calendarId: string; title: string; description: string; start: string; durationMinutes: string; location: string; meetingLink: string; attendees: string; sendInvitations: boolean; allDay: boolean };
type CalendarView = "day" | "week" | "month";
const localInput = (value: string) => { const date = new Date(value); if (Number.isNaN(date.getTime())) return value.slice(0, 16); const offset = date.getTimezoneOffset() * 60_000; return new Date(date.getTime() - offset).toISOString().slice(0, 16); };
const calendarBoundary = (date: Date) => localInput(date.toISOString());
const blankForm = (calendarId = ""): EventForm => ({ calendarId, title: "", description: "", start: localInput(new Date().toISOString()), durationMinutes: "60", location: "", meetingLink: "", attendees: "", sendInvitations: true, allDay: false });
const dateKey = (value: string | Date) => { const date = value instanceof Date ? value : new Date(value); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; };
const startOfWeek = (date: Date) => { const result = new Date(date); result.setDate(result.getDate() - result.getDay()); result.setHours(0, 0, 0, 0); return result; };
const monthGridStart = (date: Date) => startOfWeek(monthStart(date));
const monthGridEnd = (date: Date) => { const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0); const end = startOfWeek(lastDay); end.setDate(end.getDate() + 7); return end; };
const monthGridDates = (date: Date) => { const dates: Date[] = []; const end = monthGridEnd(date); for (const cursor = monthGridStart(date); cursor < end; cursor.setDate(cursor.getDate() + 1)) dates.push(new Date(cursor)); return dates; };
const sortEvents = (items: CalendarEvent[]) => [...items].sort((a, b) => a.start.localeCompare(b.start));
const formatEventTime = (event: CalendarEvent) => {
  if (event.allDay) return "All day";
  const start = new Date(event.start).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (!event.end) return start;
  const end = new Date(event.end).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return `${start} – ${end}`;
};

function LinkifiedText({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s]+)/g);
  return <>{parts.map((part, index) => /^https?:\/\//.test(part) ? <a key={`${part}-${index}`} href={part} target="_blank" rel="noreferrer">{part}</a> : <span key={`${part}-${index}`}>{part}</span>)}</>;
}

export function CalendarPage() {
  const { account, configureTopBar } = useAppShell();
  const [month, setMonth] = useState(() => monthStart(new Date()));
  const [selectedDay, setSelectedDay] = useState(() => new Date());
  const [dayModal, setDayModal] = useState<Date | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [view, setView] = useState<CalendarView>("month");
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [calendars, setCalendars] = useState<Awaited<ReturnType<typeof api.calendars>>["calendars"]>([]);
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<EventForm>(blankForm);
  const [saving, setSaving] = useState(false);
  const syncAccount = useRef<string | null>(null);
  const defaultCalendar = calendars.find((calendar) => calendar.isDefault) ?? calendars[0];
  const calendarTitle = (account?.displayName || account?.address?.split("@")[0] || "Your").replace(/^stalwart\s+/i, "").trim() || "Your";

  useEffect(() => { configureTopBar({ search: "", searchPlaceholder: "Search mail", searchDisabled: true }); }, [configureTopBar]);
  useEffect(() => {
    if (!account) return;
    let cancelled = false;
    const load = async () => {
      const after = calendarBoundary(monthGridStart(month));
      const before = calendarBoundary(monthGridEnd(month));
      setEventsLoading(true);
      try {
        if (syncAccount.current !== account.id && account.permissions.includes("send")) {
          syncAccount.current = account.id;
          void fetch("/product/calendar-events/sync-invitations", {
            method: "POST",
            credentials: "include",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ accountId: account.id }),
          }).then(async (response) => {
            if (!response.ok) throw new Error((await response.json().catch(() => ({})) as { error?: string }).error ?? "calendar invitation sync failed");
            const refreshed = await api.calendarEvents(account.id, after, before);
            if (!cancelled) setEvents(sortEvents(refreshed.events));
          }).catch((err) => console.warn("[calendar] invitation sync failed", err));
        }
        const [calendarResult, eventResult] = await Promise.all([api.calendars(account.id), api.calendarEvents(account.id, after, before)]);
        if (cancelled) return;
        setCalendars(calendarResult.calendars);
        setForm((current) => ({ ...current, calendarId: current.calendarId || calendarResult.calendars.find((calendar) => calendar.isDefault)?.engineId || calendarResult.calendars[0]?.engineId || "" }));
        setEvents(sortEvents(eventResult.events));
        setError("");
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setEventsLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [account, month]);

  const openNew = (day?: Date) => {
    setEditingId(null);
    setFormOpen(true);
    const next = blankForm(defaultCalendar?.engineId ?? "");
    if (day) next.start = localInput(new Date(day.getFullYear(), day.getMonth(), day.getDate(), 9, 0, 0).toISOString());
    setForm(next);
  };
  const openEdit = (event: CalendarEvent) => {
    const duration = event.end ? Math.max(1, Math.round((new Date(event.end).getTime() - new Date(event.start).getTime()) / 60_000)) : 60;
    setEditingId(event.engineId);
    setFormOpen(true);
    setSelectedEvent(null);
    setDayModal(null);
    setForm({ calendarId: event.calendarIds[0] ?? defaultCalendar?.engineId ?? "", title: event.title, description: event.description ?? "", start: localInput(event.start), durationMinutes: String(duration), location: event.location ?? "", meetingLink: event.meetingLink ?? "", attendees: event.attendees.join(", "), sendInvitations: false, allDay: event.allDay });
  };
  const save = async () => {
    if (!account || !form.calendarId || !form.title.trim()) return;
    setSaving(true);
    try {
      const attendees = [...new Set(form.attendees.split(/[;,\s]+/).map((email) => email.trim().toLowerCase()).filter(Boolean))];
      if (attendees.some((email) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) { setError("Enter valid attendee email addresses."); return; }
      const sendSchedulingMessages = form.sendInvitations && attendees.length > 0;
      if (sendSchedulingMessages && !window.confirm(`Send a calendar invitation email to ${attendees.join(", ")}?`)) return;
      const body = { accountId: account.id, calendarId: form.calendarId, title: form.title.trim(), description: form.description || undefined, start: form.start.length === 16 ? `${form.start}:00` : form.start, durationMinutes: Math.max(1, Number(form.durationMinutes) || 60), location: form.location || undefined, meetingLink: form.meetingLink || undefined, attendees, sendSchedulingMessages, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, allDay: form.allDay };
      const saved = editingId ? await api.updateCalendarEvent(editingId, body) : await api.createCalendarEvent(body);
      setEditingId(null);
      setFormOpen(false);
      const savedDate = new Date(saved.start);
      const targetMonth = Number.isNaN(savedDate.getTime()) ? monthStart(month) : monthStart(savedDate);
      if (!Number.isNaN(savedDate.getTime())) setSelectedDay(savedDate);
      setMonth(targetMonth);
      setEvents((current) => sortEvents([...current.filter((event) => event.engineId !== saved.engineId), saved]));
      const refreshed = (await api.calendarEvents(account.id, calendarBoundary(monthGridStart(targetMonth)), calendarBoundary(monthGridEnd(targetMonth)))).events;
      setEvents(sortEvents([...refreshed.filter((event) => event.engineId !== saved.engineId), saved]));
      setError("");
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setSaving(false); }
  };
  const remove = async (event: CalendarEvent) => {
    if (!account || !window.confirm(`Delete "${event.title}"?`)) return;
    try {
      await api.deleteCalendarEvent(event.engineId, account.id);
      setEvents((current) => current.filter((item) => item.engineId !== event.engineId));
      if (selectedEvent?.engineId === event.engineId) setSelectedEvent(null);
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  };

  const modalEvents = dayModal ? events.filter((event) => dateKey(event.start) === dateKey(dayModal)) : [];
  const copyEventDetails = async (event: CalendarEvent) => {
    const detailText = [event.title, `${new Date(event.start).toLocaleDateString()} ${formatEventTime(event)}`, event.location, event.description, event.meetingLink].filter(Boolean).join("\n");
    await navigator.clipboard.writeText(detailText);
  };

  return <MailWorkspace section="calendar"><div className="gsw-product-shell"><main className="gsw-calendar-page">
      <div className="gsw-page-heading"><div><p className="gsw-eyebrow">{calendarTitle}</p><h1>Calendar</h1><p>Your events and meeting invitations.</p></div><div className="gsw-calendar-controls"><button className="gsw-secondary-btn" onClick={() => setMonth((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))}>Previous</button><strong>{month.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</strong><button className="gsw-secondary-btn" onClick={() => setMonth((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))}>Next</button><button className="gsw-primary-btn gsw-calendar-new-event" onClick={() => openNew()}><Plus size={16} aria-hidden="true" /><span>New event</span></button></div></div>
      {error && <p className="gsw-errors">{error}</p>}
      <div className="gsw-calendar-toolbar"><div className="gsw-calendar-view-toggle">{(["day", "week", "month"] as CalendarView[]).map((item) => <button key={item} className={view === item ? "active" : ""} onClick={() => setView(item)}>{item[0]!.toUpperCase() + item.slice(1)}</button>)}</div><span>{eventsLoading ? <span className="gsw-calendar-loading-note">Loading events…</span> : defaultCalendar ? calendarTitle : "No calendar selected"}</span></div>
      <div className="gsw-calendar-layout"><aside className="gsw-calendar-list"><h2>{calendarTitle}</h2>{calendars.length ? calendars.map((calendar) => <div key={calendar.engineId}><span className="gsw-calendar-dot" style={{ background: calendar.color ?? "var(--gsw-accent)" }} />{calendar.isDefault ? calendarTitle : calendar.name}</div>) : <p>No calendars available.</p>}</aside><CalendarGrid events={events} loading={eventsLoading} month={month} selectedDay={selectedDay} view={view} onSelectDay={(day) => { setSelectedDay(day); if (view === "month") setDayModal(day); else setMonth(monthStart(day)); }} onOpen={openEdit} onDelete={remove} /></div>
      {dayModal && <div className="gsw-modal-backdrop gsw-calendar-day-backdrop" onMouseDown={() => setDayModal(null)}><section className="gsw-calendar-day-modal" role="dialog" aria-modal="true" aria-label={`Events for ${dayModal.toLocaleDateString()}`} onMouseDown={(event) => event.stopPropagation()}><div className="gsw-calendar-day-modal-head"><div><p className="gsw-eyebrow">Full day</p><h2>{dayModal.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</h2></div><button className="gsw-secondary-btn" onClick={() => setDayModal(null)}>Close</button></div><div className="gsw-calendar-day-modal-actions"><button className="gsw-primary-btn" onClick={() => { openNew(dayModal); setDayModal(null); }}><Plus size={16} aria-hidden="true" /> Add event</button></div><div className="gsw-calendar-day-modal-events">{eventsLoading ? <div className="gsw-calendar-grid-event-skeletons"><CalendarEventSkeleton compact={false} /><CalendarEventSkeleton compact={false} /><CalendarEventSkeleton compact={false} /></div> : modalEvents.length ? modalEvents.map((event) => <article key={event.engineId} role="button" tabIndex={0} onClick={() => setSelectedEvent(event)} onKeyDown={(keyEvent) => { if (keyEvent.key === "Enter" || keyEvent.key === " ") setSelectedEvent(event); }}><div className="gsw-calendar-day-modal-time">{formatEventTime(event)}</div><div className="gsw-calendar-day-modal-copy"><h3>{event.title}</h3>{event.location && <p className="gsw-calendar-event-meta">{event.location}</p>}{event.description && <p className="gsw-calendar-event-preview">{event.description}</p>}{event.meetingLink && <span className="gsw-calendar-event-link-hint">Meeting link available</span>}</div><div className="gsw-calendar-day-modal-event-actions"><span>View details</span></div></article>) : <div className="gsw-calendar-day-empty"><strong>No events</strong><p>This day is open.</p></div>}</div></section></div>}
      {selectedEvent && <div className="gsw-modal-backdrop gsw-calendar-event-backdrop" onMouseDown={() => setSelectedEvent(null)}><section className="gsw-calendar-event-modal" role="dialog" aria-modal="true" aria-label={selectedEvent.title} onMouseDown={(event) => event.stopPropagation()}><div className="gsw-calendar-event-modal-head"><div><p className="gsw-eyebrow">Event details</p><h2>{selectedEvent.title}</h2><p>{new Date(selectedEvent.start).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })} · {formatEventTime(selectedEvent)}</p></div><button className="gsw-secondary-btn" onClick={() => setSelectedEvent(null)}>Back to day</button></div><div className="gsw-calendar-event-actionbar">{selectedEvent.meetingLink && <a className="gsw-primary-btn" href={selectedEvent.meetingLink} target="_blank" rel="noreferrer"><ExternalLink size={15} /> Join meeting</a>}<button className="gsw-secondary-btn" onClick={() => openEdit(selectedEvent)}><Pencil size={15} /> Edit</button>{selectedEvent.attendees.length > 0 && <a className="gsw-secondary-btn" href={`mailto:${selectedEvent.attendees.join(",")}`}><Mail size={15} /> Email attendees</a>}<button className="gsw-secondary-btn" onClick={() => void copyEventDetails(selectedEvent)}>Copy details</button><button className="gsw-calendar-delete-action" onClick={() => void remove(selectedEvent)}><Trash2 size={15} /> Delete</button></div><div className="gsw-calendar-event-details">{selectedEvent.location && <section><strong>Location</strong>{/^https?:\/\//.test(selectedEvent.location) ? <a href={selectedEvent.location} target="_blank" rel="noreferrer">{selectedEvent.location}</a> : <p>{selectedEvent.location}</p>}</section>}{selectedEvent.meetingLink && <section><strong>Meeting link</strong><a href={selectedEvent.meetingLink} target="_blank" rel="noreferrer">{selectedEvent.meetingLink}</a></section>}{selectedEvent.attendees.length > 0 && <section><strong>Attendees</strong><div className="gsw-calendar-attendee-list">{selectedEvent.attendees.map((attendee) => <a key={attendee} href={`mailto:${attendee}`}>{attendee}</a>)}</div></section>}{selectedEvent.description && <section><strong>Details</strong><p className="gsw-calendar-event-description"><LinkifiedText text={selectedEvent.description} /></p></section>}</div></section></div>}
      {formOpen && <div className="gsw-calendar-form"><div className="gsw-page-heading"><div><p className="gsw-eyebrow">{editingId ? "Update event" : "New event"}</p><h2>{editingId ? "Edit calendar event" : "Create calendar event"}</h2></div><button className="gsw-secondary-btn" onClick={() => setFormOpen(false)}>Close</button></div><div className="gsw-calendar-form-grid"><label>Calendar<select value={form.calendarId} onChange={(event) => setForm({ ...form, calendarId: event.target.value })}>{calendars.map((calendar) => <option key={calendar.engineId} value={calendar.engineId}>{calendar.isDefault ? calendarTitle : calendar.name}</option>)}</select></label><label>Title<input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Event title" /></label><label>Starts<input type="datetime-local" value={form.start} onChange={(event) => setForm({ ...form, start: event.target.value })} /></label><label>Duration (minutes)<input type="number" min="1" value={form.durationMinutes} onChange={(event) => setForm({ ...form, durationMinutes: event.target.value })} /></label><label>Location<input value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} /></label><label>Virtual meeting link<input type="url" value={form.meetingLink} onChange={(event) => setForm({ ...form, meetingLink: event.target.value })} placeholder="https://meet.example.com/..." /></label><label>Invite attendees<input value={form.attendees} onChange={(event) => setForm({ ...form, attendees: event.target.value })} placeholder="person@example.com, guest@example.com" /><small>Attendees receive an email invitation only after confirmation.</small></label><label className="gsw-calendar-all-day"><input type="checkbox" checked={form.allDay} onChange={(event) => setForm({ ...form, allDay: event.target.checked })} /> All day</label></div><label>Description<textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /><label className="gsw-calendar-invitations"><input type="checkbox" checked={form.sendInvitations} onChange={(event) => setForm({ ...form, sendInvitations: event.target.checked })} /> Send calendar invitation emails after confirmation</label><button className="gsw-primary-btn" disabled={saving || !form.calendarId || !form.title.trim()} onClick={() => void save()}>{saving ? "Saving..." : editingId ? "Save changes" : "Create event"}</button></label></div>}
    </main></div></MailWorkspace>;
}

function CalendarGrid({ events, loading, month, selectedDay, view, onSelectDay, onOpen, onDelete }: { events: CalendarEvent[]; loading: boolean; month: Date; selectedDay: Date; view: CalendarView; onSelectDay: (day: Date) => void; onOpen: (event: CalendarEvent) => void; onDelete: (event: CalendarEvent) => void }) {
  const dates = view === "day" ? [selectedDay] : view === "week" ? Array.from({ length: 7 }, (_, index) => { const day = startOfWeek(selectedDay); day.setDate(day.getDate() + index); return day; }) : monthGridDates(month);
  return <section className={`gsw-calendar-grid gsw-calendar-grid-${view}`} aria-busy={loading}>{dates.map((day, index) => {
    const key = dateKey(day);
    const dayEvents = events.filter((event) => dateKey(event.start) === key);
    const outsideMonth = view === "month" && (day.getMonth() !== month.getMonth() || day.getFullYear() !== month.getFullYear());
    const monthEvents = dayEvents.slice(0, 2);
    return <div className={`gsw-calendar-day${outsideMonth ? " gsw-calendar-day-outside-month" : ""}`} key={key} onClick={() => onSelectDay(day)}><header><strong>{day.toLocaleDateString(undefined, { weekday: view === "month" ? "short" : "long", month: "short", day: "numeric" })}</strong></header>{view === "month" ? <div className="gsw-calendar-month-events">{loading ? <>{index % 3 === 0 && <CalendarEventSkeleton />}{index % 7 === 0 && <CalendarEventSkeleton />}</> : <>{monthEvents.map((event) => <div className="gsw-calendar-month-event" key={event.engineId}><time>{event.allDay ? "All day" : new Date(event.start).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time><span>{event.title}</span></div>)}{dayEvents.length > 2 && <div className="gsw-calendar-more-events">+{dayEvents.length - 2} more</div>}</>}</div> : loading ? <div className="gsw-calendar-grid-event-skeletons"><CalendarEventSkeleton compact={false} /><CalendarEventSkeleton compact={false} /></div> : dayEvents.map((event) => <div className="gsw-calendar-grid-event" key={event.engineId}><button onClick={(click) => { click.stopPropagation(); onOpen(event); }}><time>{event.allDay ? "All day" : new Date(event.start).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time><span>{event.title}</span>{event.meetingLink && <small>Virtual</small>}</button><button className="gsw-calendar-grid-delete" onClick={(click) => { click.stopPropagation(); void onDelete(event); }}>Delete</button></div>)}</div>;
  })}</section>;
}
