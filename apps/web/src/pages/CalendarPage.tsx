import { useEffect, useRef, useState, type ReactNode } from "react";
import { ExternalLink, Mail, Pencil, Plus, Trash2 } from "lucide-react";
import { api, type CalendarEvent, type CalendarRsvpLink, type CalendarRsvpStatus, type ComposeAttachment } from "../api";
import { useAppShell } from "../components/AppShell";
import { CalendarEventSkeleton } from "../components/LoadingSkeletons";
import { MailWorkspace } from "../components/MailWorkspace";

const monthStart = (date: Date) => new Date(date.getFullYear(), date.getMonth(), 1);
type EventForm = { calendarId: string; title: string; description: string; start: string; durationMinutes: string; location: string; meetingLink: string; attendees: string[]; attendeeDraft: string; sendInvitations: boolean; allDay: boolean };
type CalendarView = "day" | "week" | "month";
const localInput = (value: string) => { const date = new Date(value); if (Number.isNaN(date.getTime())) return value.slice(0, 16); const offset = date.getTimezoneOffset() * 60_000; return new Date(date.getTime() - offset).toISOString().slice(0, 16); };
const calendarBoundary = (date: Date) => localInput(date.toISOString());
const blankForm = (calendarId = ""): EventForm => ({ calendarId, title: "", description: "", start: localInput(new Date().toISOString()), durationMinutes: "60", location: "", meetingLink: "", attendees: [], attendeeDraft: "", sendInvitations: true, allDay: false });
const dateKey = (value: string | Date) => { const date = value instanceof Date ? value : new Date(value); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; };
const startOfWeek = (date: Date) => { const result = new Date(date); result.setDate(result.getDate() - result.getDay()); result.setHours(0, 0, 0, 0); return result; };
const monthGridStart = (date: Date) => startOfWeek(monthStart(date));
const monthGridEnd = (date: Date) => { const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0); const end = startOfWeek(lastDay); end.setDate(end.getDate() + 7); return end; };
const monthGridDates = (date: Date) => { const dates: Date[] = []; const end = monthGridEnd(date); for (const cursor = monthGridStart(date); cursor < end; cursor.setDate(cursor.getDate() + 1)) dates.push(new Date(cursor)); return dates; };
const sortEvents = (items: CalendarEvent[]) => [...items].sort((a, b) => a.start.localeCompare(b.start));
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const splitEmailInput = (value: string) => value.split(/[;,\s]+/).map((email) => email.trim().toLowerCase()).filter(Boolean);
const uniqueEmails = (values: string[]) => [...new Set(values.map((email) => email.trim().toLowerCase()).filter(Boolean))];
const htmlEscape = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
const toIcsDate = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value.replace(/[-:]/g, "").replace(/\.\d+/, "") : date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
};
const utf8Base64 = (value: string) => {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
};
const eventAttachment = (event: CalendarEvent, organizer: string): ComposeAttachment => {
  const attendees = event.attendees.map((email) => `ATTENDEE;RSVP=TRUE;PARTSTAT=NEEDS-ACTION:mailto:${email}`);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//GSW Mail//Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    `UID:${event.engineId}@mail.guidedstepswellness.com`,
    `DTSTAMP:${toIcsDate(new Date().toISOString())}`,
    `DTSTART:${toIcsDate(event.start)}`,
    ...(event.end ? [`DTEND:${toIcsDate(event.end)}`] : []),
    `SUMMARY:${event.title.replace(/\r?\n/g, " ")}`,
    ...(event.description ? [`DESCRIPTION:${event.description.replace(/\r?\n/g, "\\n")}`] : []),
    ...(event.location ? [`LOCATION:${event.location.replace(/\r?\n/g, " ")}`] : []),
    `ORGANIZER:mailto:${organizer}`,
    ...attendees,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  const content = lines.join("\r\n");
  return { filename: "invite.ics", contentType: "text/calendar; method=REQUEST; charset=UTF-8", size: new TextEncoder().encode(content).length, content: utf8Base64(content), contentDisposition: "attachment" };
};
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

export function CalendarPage({ embedded = false, active = true }: { embedded?: boolean; active?: boolean } = {}) {
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
  const [mailTemplateKey, setMailTemplateKey] = useState<"none" | "gsw_default" | "bible_reader">("none");
  const [emailEvent, setEmailEvent] = useState<CalendarEvent | null>(null);
  const [emailRecipients, setEmailRecipients] = useState<string[]>([]);
  const [emailDraft, setEmailDraft] = useState("");
  const [emailSending, setEmailSending] = useState(false);
  const [contactOptions, setContactOptions] = useState<Awaited<ReturnType<typeof api.contacts>>>([]);
  const [rsvpStatuses, setRsvpStatuses] = useState<CalendarRsvpStatus[]>([]);
  const [rsvpLoading, setRsvpLoading] = useState(false);
  const syncAccount = useRef<string | null>(null);
  const defaultCalendar = calendars.find((calendar) => calendar.isDefault) ?? calendars[0];
  const calendarTitle = (account?.displayName || account?.address?.split("@")[0] || "Your").replace(/^stalwart\s+/i, "").trim() || "Your";

  useEffect(() => { if (!embedded) configureTopBar({ search: "", searchPlaceholder: "Search mail", searchDisabled: true }); }, [configureTopBar, embedded]);
  useEffect(() => {
    void api.settings().then((settings) => {
      const selected = String(settings.general.templateKey ?? "none");
      const supportsBrandedTemplate = account?.address.toLowerCase().endsWith("@team.guidedstepswellness.com") === true;
      if (supportsBrandedTemplate && (selected === "gsw_default" || selected === "bible_reader")) setMailTemplateKey(selected);
      else if (supportsBrandedTemplate) setMailTemplateKey("gsw_default");
      else setMailTemplateKey("none");
    }).catch(() => undefined);
  }, [account?.address]);
  useEffect(() => { void api.contacts("").then(setContactOptions).catch(() => undefined); }, []);
  useEffect(() => {
    if (!account || !selectedEvent || selectedEvent.attendees.length === 0) {
      setRsvpStatuses([]);
      return;
    }
    let cancelled = false;
    setRsvpLoading(true);
    void api.calendarRsvpStatuses(account.id, selectedEvent.engineId)
      .then((result) => { if (!cancelled) setRsvpStatuses(result.responses); })
      .catch(() => { if (!cancelled) setRsvpStatuses([]); })
      .finally(() => { if (!cancelled) setRsvpLoading(false); });
    return () => { cancelled = true; };
  }, [account, selectedEvent]);
  useEffect(() => {
    if (!account) return;
    let cancelled = false;
    const load = async () => {
      const after = calendarBoundary(monthGridStart(month));
      const before = calendarBoundary(monthGridEnd(month));
      setEventsLoading(true);
      try {
        if (active && syncAccount.current !== account.id && account.permissions.includes("send")) {
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
  }, [account, month, active]);

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
    setForm({ calendarId: event.calendarIds[0] ?? defaultCalendar?.engineId ?? "", title: event.title, description: event.description ?? "", start: localInput(event.start), durationMinutes: String(duration), location: event.location ?? "", meetingLink: event.meetingLink ?? "", attendees: uniqueEmails(event.attendees), attendeeDraft: "", sendInvitations: false, allDay: event.allDay });
  };
  const addAttendees = (value: string) => {
    const next = splitEmailInput(value);
    if (!next.length) return true;
    const invalid = next.find((email) => !emailPattern.test(email));
    if (invalid) {
      setError(`${invalid} is not a valid email address.`);
      return false;
    }
    setForm((current) => ({ ...current, attendees: uniqueEmails([...current.attendees, ...next]), attendeeDraft: "" }));
    setError("");
    return true;
  };
  const removeAttendee = (email: string) => setForm((current) => ({ ...current, attendees: current.attendees.filter((item) => item !== email) }));
  const eventEmailHtml = (event: CalendarEvent, mode: "invite" | "update", rsvp: CalendarRsvpLink) => {
    const accent = mailTemplateKey === "bible_reader" ? "#b98a45" : "#e89a12";
    const start = new Date(event.start);
    const heading = mode === "invite" ? "You’re invited" : "Meeting update";
    const details = [
      start.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" }),
      event.allDay ? "All day" : formatEventTime(event),
    ].join(" · ");
    const brandMark = mailTemplateKey === "none" ? `<img src="https://mail.guidedstepswellness.com/guided_steps_logo.png" alt="GSW Mail" width="44" height="44" style="display:block;width:44px;height:44px;object-fit:contain;border:0" />` : "";
    const rsvpButtons = `<div style="margin-top:24px;padding-top:20px;border-top:1px solid #eee8dd"><div style="margin-bottom:10px;font-size:13px;font-weight:700">Will you attend?</div><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding-right:8px"><a href="${htmlEscape(rsvp.acceptedUrl)}" style="display:inline-block;padding:10px 16px;border-radius:7px;background:${accent};color:#fff;text-decoration:none;font-size:13px;font-weight:700">Yes</a></td><td style="padding-right:8px"><a href="${htmlEscape(rsvp.declinedUrl)}" style="display:inline-block;padding:10px 16px;border-radius:7px;border:1px solid #d9d1c5;color:#4b473f;text-decoration:none;font-size:13px;font-weight:700">No</a></td><td><a href="${htmlEscape(rsvp.tentativeUrl)}" style="display:inline-block;padding:10px 16px;border-radius:7px;border:1px solid #d9d1c5;color:#4b473f;text-decoration:none;font-size:13px;font-weight:700">Maybe</a></td></tr></table><div style="margin-top:10px;font-size:11px;color:#837e75">Or <a href="${htmlEscape(rsvp.pageUrl)}" style="color:#8d6b37">open the GSW RSVP page</a> to review the meeting first.</div></div>`;
    return `<div style="margin:0 auto;max-width:620px;font-family:Arial,sans-serif;color:#383631"><div style="display:flex;align-items:center;gap:12px;margin-bottom:22px">${brandMark}<div><div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:${accent};font-weight:700">${heading}</div><div style="font-size:21px;font-weight:700">${htmlEscape(event.title)}</div></div></div><div style="border:1px solid #e8e1d4;border-radius:12px;overflow:hidden"><div style="padding:22px 24px;border-top:4px solid ${accent}"><div style="font-size:14px;font-weight:700;margin-bottom:6px">When</div><div style="font-size:14px;margin-bottom:18px">${htmlEscape(details)}</div>${event.location ? `<div style="font-size:14px;font-weight:700;margin-bottom:6px">Location</div><div style="font-size:14px;margin-bottom:18px">${htmlEscape(event.location)}</div>` : ""}${event.description ? `<div style="font-size:14px;font-weight:700;margin-bottom:6px">Details</div><div style="font-size:14px;line-height:1.6;margin-bottom:18px">${htmlEscape(event.description).replaceAll("\n", "<br />")}</div>` : ""}${event.meetingLink ? `<a href="${htmlEscape(event.meetingLink)}" style="display:inline-block;padding:11px 18px;border-radius:7px;background:${accent};color:#fff;text-decoration:none;font-size:14px;font-weight:700">Join meeting</a>` : ""}${rsvpButtons}</div></div><div style="margin-top:14px;color:#77756f;font-size:12px;line-height:1.5">This invitation was sent through GSW Mail at mail.guidedstepswellness.com. The attached calendar file can also be opened in your calendar app.</div></div>`;
  };
  const sendEventEmail = async (event: CalendarEvent, recipients: string[], mode: "invite" | "update") => {
    if (!account || recipients.length === 0) return;
    const normalizedRecipients = uniqueEmails(recipients);
    const { links } = await api.calendarRsvpLinks({
      accountId: account.id,
      event: {
        engineId: event.engineId,
        title: event.title,
        start: event.start,
        ...(event.end ? { end: event.end } : {}),
        ...(event.location ? { location: event.location } : {}),
        ...(event.meetingLink ? { meetingLink: event.meetingLink } : {}),
        attendees: normalizedRecipients,
      },
    });

    for (const rsvp of links) {
      const text = [
        mode === "invite" ? `Invitation: ${event.title}` : `Meeting update: ${event.title}`,
        `${new Date(event.start).toLocaleDateString()} ${formatEventTime(event)}`,
        event.location ? `Location: ${event.location}` : "",
        event.description ?? "",
        event.meetingLink ? `Join: ${event.meetingLink}` : "",
        `RSVP: ${rsvp.pageUrl}`,
        `Yes: ${rsvp.acceptedUrl}`,
        `No: ${rsvp.declinedUrl}`,
        `Maybe: ${rsvp.tentativeUrl}`,
      ].filter(Boolean).join("\n\n");
      await api.send(account.id, [rsvp.email], {
        subject: mode === "invite" ? `Invitation: ${event.title}` : `Meeting update: ${event.title}`,
        textBody: text,
        htmlBody: eventEmailHtml(event, mode, rsvp),
        templateKey: mailTemplateKey,
        attachments: [eventAttachment(event, account.address)],
        clientRequestId: `calendar:${event.engineId}:${mode}:${rsvp.email}:${crypto.randomUUID()}`,
      });
    }
  };
  const openAttendeeEmail = (event: CalendarEvent) => {
    setEmailEvent(event);
    setEmailRecipients(uniqueEmails(event.attendees));
    setEmailDraft("");
  };
  const addEmailRecipient = (value: string) => {
    const next = splitEmailInput(value);
    if (!next.length) return true;
    const invalid = next.find((email) => !emailPattern.test(email));
    if (invalid) {
      setError(`${invalid} is not a valid email address.`);
      return false;
    }
    setEmailRecipients((current) => uniqueEmails([...current, ...next]));
    setEmailDraft("");
    setError("");
    return true;
  };
  const sendAttendeeUpdate = async () => {
    if (!emailEvent || emailRecipients.length === 0) return;
    setEmailSending(true);
    try {
      await sendEventEmail(emailEvent, emailRecipients, "update");
      setEmailEvent(null);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setEmailSending(false);
    }
  };
  const save = async () => {
    if (!account || !form.calendarId || !form.title.trim()) return;
    setSaving(true);
    try {
      if (form.attendeeDraft.trim() && !addAttendees(form.attendeeDraft)) return;
      const pending = form.attendeeDraft.trim() ? splitEmailInput(form.attendeeDraft) : [];
      const attendees = uniqueEmails([...form.attendees, ...pending]);
      const invalid = attendees.find((email) => !emailPattern.test(email));
      if (invalid) { setError(`${invalid} is not a valid email address.`); return; }
      const body = { accountId: account.id, calendarId: form.calendarId, title: form.title.trim(), description: form.description || undefined, start: form.start.length === 16 ? `${form.start}:00` : form.start, durationMinutes: Math.max(1, Number(form.durationMinutes) || 60), location: form.location || undefined, meetingLink: form.meetingLink || undefined, attendees, sendSchedulingMessages: false, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, allDay: form.allDay };
      const wasEditing = Boolean(editingId);
      const saved = editingId ? await api.updateCalendarEvent(editingId, body) : await api.createCalendarEvent(body);
      if (form.sendInvitations && attendees.length > 0) await sendEventEmail(saved, attendees, wasEditing ? "update" : "invite");
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

  const wrap = (node: ReactNode) => embedded ? <div className="gsw-embedded-workspace gsw-embedded-calendar">{node}</div> : <MailWorkspace section="calendar">{node}</MailWorkspace>;
  return wrap(<div className="gsw-product-shell"><main className="gsw-calendar-page">
      <div className="gsw-page-heading"><div><p className="gsw-eyebrow">{calendarTitle}</p><h1>Calendar</h1><p>Your events and meeting invitations.</p></div><div className="gsw-calendar-controls"><button className="gsw-secondary-btn" onClick={() => setMonth((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))}>Previous</button><strong>{month.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</strong><button className="gsw-secondary-btn" onClick={() => setMonth((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))}>Next</button><button className="gsw-primary-btn gsw-calendar-new-event" onClick={() => openNew()}><Plus size={16} aria-hidden="true" /><span>New event</span></button></div></div>
      {error && <p className="gsw-errors">{error}</p>}
      <div className="gsw-calendar-toolbar"><div className="gsw-calendar-view-toggle">{(["day", "week", "month"] as CalendarView[]).map((item) => <button key={item} className={view === item ? "active" : ""} onClick={() => setView(item)}>{item[0]!.toUpperCase() + item.slice(1)}</button>)}</div><span>{eventsLoading ? <span className="gsw-calendar-loading-note">Loading events…</span> : defaultCalendar ? calendarTitle : "No calendar selected"}</span></div>
      <div className="gsw-calendar-layout"><aside className="gsw-calendar-list"><h2>{calendarTitle}</h2>{calendars.length ? calendars.map((calendar) => <div key={calendar.engineId}><span className="gsw-calendar-dot" style={{ background: calendar.color ?? "var(--gsw-accent)" }} />{calendar.isDefault ? calendarTitle : calendar.name}</div>) : <p>No calendars available.</p>}</aside><CalendarGrid events={events} loading={eventsLoading} month={month} selectedDay={selectedDay} view={view} onSelectDay={(day) => { setSelectedDay(day); if (view === "month") setDayModal(day); else setMonth(monthStart(day)); }} onOpen={openEdit} onDelete={remove} /></div>
      {dayModal && <div className="gsw-modal-backdrop gsw-calendar-day-backdrop" onMouseDown={() => setDayModal(null)}><section className="gsw-calendar-day-modal" role="dialog" aria-modal="true" aria-label={`Events for ${dayModal.toLocaleDateString()}`} onMouseDown={(event) => event.stopPropagation()}><div className="gsw-calendar-day-modal-head"><div><p className="gsw-eyebrow">Full day</p><h2>{dayModal.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</h2></div><button className="gsw-secondary-btn" onClick={() => setDayModal(null)}>Close</button></div><div className="gsw-calendar-day-modal-actions"><button className="gsw-primary-btn" onClick={() => { openNew(dayModal); setDayModal(null); }}><Plus size={16} aria-hidden="true" /> Add event</button></div><div className="gsw-calendar-day-modal-events">{eventsLoading ? <div className="gsw-calendar-grid-event-skeletons"><CalendarEventSkeleton compact={false} /><CalendarEventSkeleton compact={false} /><CalendarEventSkeleton compact={false} /></div> : modalEvents.length ? modalEvents.map((event) => <article key={event.engineId} role="button" tabIndex={0} onClick={() => setSelectedEvent(event)} onKeyDown={(keyEvent) => { if (keyEvent.key === "Enter" || keyEvent.key === " ") setSelectedEvent(event); }}><div className="gsw-calendar-day-modal-time">{formatEventTime(event)}</div><div className="gsw-calendar-day-modal-copy"><h3>{event.title}</h3>{event.location && <p className="gsw-calendar-event-meta">{event.location}</p>}{event.description && <p className="gsw-calendar-event-preview">{event.description}</p>}{event.meetingLink && <span className="gsw-calendar-event-link-hint">Meeting link available</span>}</div><div className="gsw-calendar-day-modal-event-actions"><span>View details</span></div></article>) : <div className="gsw-calendar-day-empty"><strong>No events</strong><p>This day is open.</p></div>}</div></section></div>}
      {selectedEvent && <div className="gsw-modal-backdrop gsw-calendar-event-backdrop" onMouseDown={() => setSelectedEvent(null)}><section className="gsw-calendar-event-modal" role="dialog" aria-modal="true" aria-label={selectedEvent.title} onMouseDown={(event) => event.stopPropagation()}><div className="gsw-calendar-event-modal-head"><div><p className="gsw-eyebrow">Event details</p><h2>{selectedEvent.title}</h2><p>{new Date(selectedEvent.start).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })} · {formatEventTime(selectedEvent)}</p></div><button className="gsw-secondary-btn" onClick={() => setSelectedEvent(null)}>Back to day</button></div><div className="gsw-calendar-event-actionbar">{selectedEvent.meetingLink && <a className="gsw-primary-btn" href={selectedEvent.meetingLink} target="_blank" rel="noreferrer"><ExternalLink size={15} /> Join meeting</a>}<button className="gsw-secondary-btn" onClick={() => openEdit(selectedEvent)}><Pencil size={15} /> Edit</button>{selectedEvent.attendees.length > 0 && <button className="gsw-secondary-btn" onClick={() => openAttendeeEmail(selectedEvent)}><Mail size={15} /> Email attendees</button>}<button className="gsw-secondary-btn" onClick={() => void copyEventDetails(selectedEvent)}>Copy details</button><button className="gsw-calendar-delete-action" onClick={() => void remove(selectedEvent)}><Trash2 size={15} /> Delete</button></div><div className="gsw-calendar-event-details">{selectedEvent.location && <section><strong>Location</strong>{/^https?:\/\//.test(selectedEvent.location) ? <a href={selectedEvent.location} target="_blank" rel="noreferrer">{selectedEvent.location}</a> : <p>{selectedEvent.location}</p>}</section>}{selectedEvent.meetingLink && <section><strong>Meeting link</strong><a href={selectedEvent.meetingLink} target="_blank" rel="noreferrer">{selectedEvent.meetingLink}</a></section>}{selectedEvent.attendees.length > 0 && <section><strong>Attendees</strong><div className="gsw-calendar-rsvp-summary">{(() => { const accepted = rsvpStatuses.filter((item) => item.response === "accepted").length; return <span>{accepted} yes · {selectedEvent.attendees.length} invited</span>; })()}{rsvpLoading && <span>Refreshing responses…</span>}</div><div className="gsw-calendar-rsvp-list">{selectedEvent.attendees.map((attendee) => { const status = rsvpStatuses.find((item) => item.attendeeEmail.toLowerCase() === attendee.toLowerCase()); const response = status?.response ?? null; const label = response === "accepted" ? "Yes" : response === "declined" ? "No" : response === "tentative" ? "Maybe" : "Pending"; return <div className="gsw-calendar-rsvp-person" key={attendee}><span className="gsw-calendar-rsvp-email">{attendee}</span><span className={`gsw-calendar-rsvp-badge ${response ?? "pending"}`}>{label}</span></div>; })}</div></section>}{selectedEvent.description && <section><strong>Details</strong><p className="gsw-calendar-event-description"><LinkifiedText text={selectedEvent.description} /></p></section>}</div></section></div>}
      {emailEvent && <div className="gsw-modal-backdrop gsw-calendar-email-backdrop" onMouseDown={() => setEmailEvent(null)}><section className="gsw-calendar-email-modal" role="dialog" aria-modal="true" aria-label="Email attendees" onMouseDown={(event) => event.stopPropagation()}><div className="gsw-calendar-event-modal-head"><div><p className="gsw-eyebrow">GSW Mail</p><h2>Email attendees</h2><p>Choose who should receive the formatted meeting update.</p></div><button className="gsw-secondary-btn" onClick={() => setEmailEvent(null)}>Close</button></div><div className="gsw-calendar-email-recipients">{uniqueEmails(emailEvent.attendees).map((attendee) => <label key={attendee}><input type="checkbox" checked={emailRecipients.includes(attendee)} onChange={(event) => setEmailRecipients((current) => event.target.checked ? uniqueEmails([...current, attendee]) : current.filter((item) => item !== attendee))} /><span>{attendee}</span></label>)}</div><label className="gsw-calendar-email-add">Add an email or contact<div className="gsw-calendar-attendee-input"><input value={emailDraft} onChange={(event) => setEmailDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === ",") { event.preventDefault(); void addEmailRecipient(emailDraft); } }} placeholder="Name or person@example.com" /></div><small>Choose a contact below, or press Enter/comma to add an email.</small></label>{emailDraft.trim() && <div className="gsw-calendar-contact-suggestions">{contactOptions.flatMap((contact) => contact.emails.map((entry) => ({ name: contact.displayName || [contact.firstName, contact.lastName].filter(Boolean).join(" ") || entry.email, email: entry.email }))).filter((item) => `${item.name} ${item.email}`.toLowerCase().includes(emailDraft.trim().toLowerCase()) && !emailRecipients.includes(item.email.toLowerCase())).slice(0, 5).map((item) => <button type="button" key={item.email} onClick={() => { setEmailRecipients((current) => uniqueEmails([...current, item.email])); setEmailDraft(""); }}><strong>{item.name}</strong><span>{item.email}</span></button>)}</div>}{emailRecipients.filter((email) => !emailEvent.attendees.includes(email)).length > 0 && <div className="gsw-calendar-email-extra">{emailRecipients.filter((email) => !emailEvent.attendees.includes(email)).map((email) => <span key={email}>{email}<button type="button" onClick={() => setEmailRecipients((current) => current.filter((item) => item !== email))}>×</button></span>)}</div>}<div className="gsw-calendar-email-actions"><span>{emailRecipients.length} selected</span><button className="gsw-primary-btn" disabled={emailSending || emailRecipients.length === 0} onClick={() => void sendAttendeeUpdate()}>{emailSending ? "Sending…" : "Send update"}</button></div></section></div>}
      {formOpen && <div className="gsw-calendar-form"><div className="gsw-page-heading"><div><p className="gsw-eyebrow">{editingId ? "Update event" : "New event"}</p><h2>{editingId ? "Edit calendar event" : "Create calendar event"}</h2></div><button className="gsw-secondary-btn" onClick={() => setFormOpen(false)}>Close</button></div><div className="gsw-calendar-form-grid"><label>Calendar<select value={form.calendarId} onChange={(event) => setForm({ ...form, calendarId: event.target.value })}>{calendars.map((calendar) => <option key={calendar.engineId} value={calendar.engineId}>{calendar.isDefault ? calendarTitle : calendar.name}</option>)}</select></label><label>Title<input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Event title" /></label><label>Starts<input type="datetime-local" value={form.start} onChange={(event) => setForm({ ...form, start: event.target.value })} /></label><label>Duration (minutes)<input type="number" min="1" value={form.durationMinutes} onChange={(event) => setForm({ ...form, durationMinutes: event.target.value })} /></label><label>Location<input value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} /></label><label>Virtual meeting link<input type="url" value={form.meetingLink} onChange={(event) => setForm({ ...form, meetingLink: event.target.value })} placeholder="https://meet.example.com/..." /></label><label>Invite attendees<div className="gsw-calendar-attendee-input">{form.attendees.map((attendee) => <span className="gsw-calendar-attendee-chip" key={attendee}>{attendee}<button type="button" aria-label={`Remove ${attendee}`} onClick={() => removeAttendee(attendee)}>×</button></span>)}<input value={form.attendeeDraft} onChange={(event) => setForm({ ...form, attendeeDraft: event.target.value })} onKeyDown={(event) => { if (event.key === "Enter" || event.key === ",") { event.preventDefault(); void addAttendees(form.attendeeDraft); } }} onBlur={() => { if (form.attendeeDraft.trim()) void addAttendees(form.attendeeDraft); }} placeholder={form.attendees.length ? "Add another email" : "person@example.com"} /></div><small>Type an email, then press Enter or comma. Valid addresses become attendee tiles.</small></label><label className="gsw-calendar-all-day"><input type="checkbox" checked={form.allDay} onChange={(event) => setForm({ ...form, allDay: event.target.checked })} /> All day</label></div><label>Description<textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /><label className="gsw-calendar-invitations"><input type="checkbox" checked={form.sendInvitations} onChange={(event) => setForm({ ...form, sendInvitations: event.target.checked })} /> Send invitation or update emails through GSW Mail when this event is saved</label><button className="gsw-primary-btn" disabled={saving || !form.calendarId || !form.title.trim()} onClick={() => void save()}>{saving ? "Saving..." : editingId ? "Save changes" : "Create event"}</button></label></div>}
    </main></div>);
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
