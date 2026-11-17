import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, ExternalLink, Mail, Pencil, Plus, Trash2 } from "lucide-react";
import { api, type CalendarEvent, type CalendarRsvpLink, type CalendarRsvpStatus, type ComposeAttachment } from "../api";
import { submitMeetingHandoff } from "../lib/meetingHandoff";
import { useAppShell } from "../components/AppShell";
import { CalendarEventSkeleton } from "../components/LoadingSkeletons";
import { MailWorkspace } from "../components/MailWorkspace";

const monthStart = (date: Date) => new Date(date.getFullYear(), date.getMonth(), 1);
type EventForm = { meetingRequestId: string; calendarId: string; title: string; description: string; start: string; durationMinutes: string; location: string; meetingLink: string; attendees: string[]; attendeeDraft: string; sendInvitations: boolean; allDay: boolean; emailReminderMinutes: number[] };
type CalendarView = "day" | "week" | "month";
const localInput = (value: string) => { const date = new Date(value); if (Number.isNaN(date.getTime())) return value.slice(0, 16); const offset = date.getTimezoneOffset() * 60_000; return new Date(date.getTime() - offset).toISOString().slice(0, 16); };
const calendarBoundary = (date: Date) => localInput(date.toISOString());
const blankForm = (calendarId = ""): EventForm => ({ meetingRequestId: crypto.randomUUID(), calendarId, title: "", description: "", start: localInput(new Date().toISOString()), durationMinutes: "60", location: "", meetingLink: "", attendees: [], attendeeDraft: "", sendInvitations: true, allDay: false, emailReminderMinutes: [1440,30] });
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
    ...(event.meetingLink ? ["URL:" + event.meetingLink.replace(/[\r\n]/g, "")] : []),
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
  const [joiningHost, setJoiningHost] = useState(false);
  const [hostError, setHostError] = useState("");
  const [eventOwnerCode, setEventOwnerCode] = useState("");
  const [loadingOwnerCode, setLoadingOwnerCode] = useState(false);
  const ownerCodeEpoch = useRef(0);
  useEffect(() => { ownerCodeEpoch.current += 1; setEventOwnerCode(""); setLoadingOwnerCode(false); }, [selectedEvent?.engineId, account?.id]);
  const showOwnerCode = async () => {
    if (!account || !selectedEvent) return;
    const epoch = ownerCodeEpoch.current;
    setLoadingOwnerCode(true); setHostError("");
    try {
      const result = await api.privateMeetingOwnerCode({accountId: account.id, eventId: selectedEvent.engineId});
      if (epoch === ownerCodeEpoch.current) setEventOwnerCode(result.ownerCode);
    } catch { if (epoch === ownerCodeEpoch.current) setHostError("Could not retrieve an unused organizer code. Select Host meeting to enter securely."); }
    finally { if (epoch === ownerCodeEpoch.current) setLoadingOwnerCode(false); }
  };
  const [generatingMeeting, setGeneratingMeeting] = useState(false);
  const [meetingError, setMeetingError] = useState("");
  const [ownerCode, setOwnerCode] = useState("");
  const meetingInputId = useId();
  const meetingEpoch = useRef(0);
  const meetingAttempt = useRef<{ key: string; input: Parameters<typeof api.createPrivateMeeting>[0]; pending: boolean; url?: string; ownerCode?: string } | null>(null);
  const resetMeetingGeneration = () => {
    meetingEpoch.current += 1;
    setOwnerCode("");
    meetingAttempt.current = null;
    setGeneratingMeeting(false);
    setMeetingError("");
  };
  const closeForm = () => { resetMeetingGeneration(); setFormOpen(false); };
  useEffect(() => { resetMeetingGeneration(); setFormOpen(false); }, [account?.id]);
  useEffect(() => () => { meetingEpoch.current += 1; }, []);
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
  useEffect(() => { void api.contacts("").then(setContactOptions).catch(() => undefined); }, []);
  useEffect(() => {
    if (!account || !selectedEvent || selectedEvent.attendees.length === 0) {
      setRsvpStatuses([]);
      return;
    }
    let cancelled = false;
    const refreshResponses = async (showLoading = false) => {
      if (showLoading) setRsvpLoading(true);
      try {
        const result = await api.calendarRsvpStatuses(account.id, selectedEvent.engineId);
        if (!cancelled) setRsvpStatuses(result.responses);
      } catch {
        if (!cancelled && showLoading) setRsvpStatuses([]);
      } finally {
        if (!cancelled && showLoading) setRsvpLoading(false);
      }
    };
    void refreshResponses(true);
    const interval = window.setInterval(() => { if (document.visibilityState === "visible") void refreshResponses(false); }, 15_000);
    const onFocus = () => { void refreshResponses(false); };
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [account, selectedEvent]);
  useEffect(() => {
    if (!account) return;
    let cancelled = false;
    const load = async (showLoading = true) => {
      const after = calendarBoundary(monthGridStart(month));
      const before = calendarBoundary(monthGridEnd(month));
      if (showLoading) setEventsLoading(true);
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
        if (!cancelled && showLoading) setEventsLoading(false);
      }
    };
    void load();
    const refresh = () => { if (active && document.visibilityState === "visible") void load(false); };
    const timer = window.setInterval(refresh, 30000);
    window.addEventListener("focus", refresh);
    return () => { cancelled = true; window.clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [account, month, active]);

  const navigatePeriod = (direction: number) => {
    if (view === "month") {
      const next = new Date(month.getFullYear(), month.getMonth() + direction, 1);
      setMonth(next);
      setSelectedDay(next);
      return;
    }
    const next = new Date(selectedDay);
    next.setDate(next.getDate() + direction * (view === "week" ? 7 : 1));
    setSelectedDay(next);
    setMonth(monthStart(next));
  };
  const periodTitle = view === "day"
    ? selectedDay.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" })
    : view === "week"
      ? (() => { const first = startOfWeek(selectedDay); const last = new Date(first); last.setDate(last.getDate() + 6); return first.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + " – " + last.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); })()
      : month.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  const openNew = (day?: Date) => {
    resetMeetingGeneration();
    setEditingId(null);
    setFormOpen(true);
    const next = blankForm(defaultCalendar?.engineId ?? "");
    if (day) next.start = localInput(new Date(day.getFullYear(), day.getMonth(), day.getDate(), 9, 0, 0).toISOString());
    setForm(next);
  };
  const openEdit = (event: CalendarEvent) => {
    resetMeetingGeneration();
    const duration = event.end ? Math.max(1, Math.round((new Date(event.end).getTime() - new Date(event.start).getTime()) / 60_000)) : 60;
    setEditingId(event.engineId);
    setFormOpen(true);
    setSelectedEvent(null);
    setDayModal(null);
    setForm({ meetingRequestId: crypto.randomUUID(), calendarId: event.calendarIds[0] ?? defaultCalendar?.engineId ?? "", title: event.title, description: event.description ?? "", start: localInput(event.start), durationMinutes: String(duration), location: event.location ?? "", meetingLink: event.meetingLink ?? "", attendees: uniqueEmails(event.attendees), attendeeDraft: "", sendInvitations: false, allDay: event.allDay, emailReminderMinutes: [1440,30] });
    if (account) void api.calendarEventReminders(event.engineId, account.id).then(result => setForm(current => ({...current,emailReminderMinutes:result.minutes}))).catch(() => setError("Could not load event reminder settings."));
  };
  const generateMeeting = async () => {
    if (!account || saving || form.meetingLink.trim() || meetingAttempt.current?.pending) return;
    const start = new Date(form.start);
    if (!Number.isFinite(start.getTime())) { setMeetingError("Choose a valid start time first."); return; }
    const key = `${account.id}:${form.meetingRequestId}`;
    if (meetingAttempt.current?.key !== key) meetingAttempt.current = {
      key, pending: false,
      input: { accountId: account.id, externalEventId: form.meetingRequestId, title: form.title.trim() || "Private meeting", scheduledAt: start.toISOString(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
    };
    const attempt = meetingAttempt.current;
    const epoch = meetingEpoch.current;
    setMeetingError("");
    attempt.pending = true;
    setGeneratingMeeting(true);
    try {
      if (!attempt.url) {
        const result = await api.createPrivateMeeting(attempt.input);
        attempt.url = result.joinUrl;
        attempt.ownerCode = result.ownerCode;
      }
      const url = attempt.url;
      if (meetingEpoch.current === epoch) setOwnerCode(attempt.ownerCode ?? "");
      if (meetingEpoch.current === epoch) setForm(current => current.meetingRequestId === attempt.input.externalEventId && !current.meetingLink.trim() ? { ...current, meetingLink: url } : current);
    } catch (error) {
      if (meetingEpoch.current === epoch) {
        const message = error instanceof Error ? error.message : "";
        setMeetingError(message.includes("meeting_entitlement_required") ? "A paid GSW Mail plan is required to generate meeting links."
          : message.includes("meetings_disabled") || message.includes("meetings_not_configured") ? "Meeting link generation is not available yet. You can still paste a link."
          : "Could not generate a meeting link. Please try again.");
      }
    } finally {
      attempt.pending = false;
      if (meetingEpoch.current === epoch) setGeneratingMeeting(false);
    }
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
    const accent = "#e89a12";
    const start = new Date(event.start);
    const heading = mode === "invite" ? "You’re invited" : "Meeting update";
    const details = [
      start.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" }),
      event.allDay ? "All day" : formatEventTime(event),
    ].join(" · ");
    const brandMark = `<img src="https://mail.guidedstepswellness.com/favicon.png" alt="GSW Mail" width="44" height="44" style="display:block;width:44px;height:44px;object-fit:contain;border:0" />`;
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
        templateKey: "none",
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
    if (!account || !form.calendarId || !form.title.trim() || meetingAttempt.current?.pending) return;
    setSaving(true);
    try {
      if (form.attendeeDraft.trim() && !addAttendees(form.attendeeDraft)) return;
      const pending = form.attendeeDraft.trim() ? splitEmailInput(form.attendeeDraft) : [];
      const attendees = uniqueEmails([...form.attendees, ...pending]);
      const invalid = attendees.find((email) => !emailPattern.test(email));
      if (invalid) { setError(`${invalid} is not a valid email address.`); return; }
      const body = { accountId: account.id, calendarId: form.calendarId, title: form.title.trim(), description: form.description || undefined, start: form.start.length === 16 ? `${form.start}:00` : form.start, durationMinutes: Math.max(1, Number(form.durationMinutes) || 60), location: form.location || undefined, meetingLink: form.meetingLink || undefined, attendees, sendSchedulingMessages: false, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, allDay: form.allDay, emailReminderMinutes: form.emailReminderMinutes };
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
  const hostMeeting = async (event: CalendarEvent) => {
    if (!account || !event.meetingLink || joiningHost) return;
    setJoiningHost(true);
    setHostError("");
    try {
      const url = new URL(event.meetingLink);
      const meetingId = url.pathname.slice(6);
      const handoff = await api.privateMeetingHost({ accountId: account.id, meetingId });
      submitMeetingHandoff(handoff, url.origin);
    } catch { setHostError("Could not open organizer access. Only the meeting creator with an eligible account can host."); }
    finally { setJoiningHost(false); }
  };
  const isPartnerMeeting = (link?: string) => {
    if (!link) return false;
    try { const url = new URL(link); return url.origin === "https://bible.guidedstepswellness.com" && /^\/meet\/[a-zA-Z0-9_-]{1,200}$/.test(url.pathname) && !url.search && !url.hash && !url.username && !url.password; }
    catch { return false; }
  };
  const remove = async (event: CalendarEvent) => {
    if (!account || !window.confirm(`Delete "${event.title}"?`)) return;
    try {
      await api.deleteCalendarEvent(event.engineId, account.id);
      setEvents((current) => current.filter((item) => item.engineId !== event.engineId));
      if (selectedEvent?.engineId === event.engineId) setSelectedEvent(null);
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  };

  const modalEvents = dayModal ? events.filter((event) => eventTouchesDay(event, dayModal)) : [];
  const copyEventDetails = async (event: CalendarEvent) => {
    const detailText = [event.title, `${new Date(event.start).toLocaleDateString()} ${formatEventTime(event)}`, event.location, event.description, event.meetingLink].filter(Boolean).join("\n");
    await navigator.clipboard.writeText(detailText);
  };

  const wrap = (node: ReactNode) => embedded ? <div className="gsw-embedded-workspace gsw-embedded-calendar">{node}</div> : <MailWorkspace section="calendar">{node}</MailWorkspace>;
  return wrap(<div className="gsw-product-shell gsw-calendar-shell"><main className="gsw-calendar-page">
      <header className="gsw-calendar-header">
        <h1>Calendar</h1>
        <div className="gsw-calendar-period" aria-label="Calendar navigation">
          <button type="button" className="gsw-secondary-btn" aria-label={`Previous ${view}`} title={`Previous ${view}`} onClick={() => navigatePeriod(-1)}><ChevronLeft size={20} aria-hidden="true" /></button>
          <strong aria-live="polite">{periodTitle}</strong>
          <button type="button" className="gsw-secondary-btn" aria-label={`Next ${view}`} title={`Next ${view}`} onClick={() => navigatePeriod(1)}><ChevronRight size={20} aria-hidden="true" /></button>
        </div>
        <div className="gsw-calendar-header-actions">
          <div className="gsw-calendar-view-toggle" role="group" aria-label="Calendar view">{(["day", "week", "month"] as CalendarView[]).map((item) => <button type="button" key={item} className={view === item ? "active" : ""} aria-label={item[0]!.toUpperCase() + item.slice(1)} aria-pressed={view === item} title={item[0]!.toUpperCase() + item.slice(1)} onClick={() => setView(item)}>{item[0]!.toUpperCase() + (view === item ? item.slice(1) : "")}</button>)}</div>
          <button type="button" className="gsw-primary-btn gsw-calendar-new-event" onClick={() => openNew()}><Plus size={18} aria-hidden="true" /><span>New event</span></button>
        </div>
      </header>
      {(eventsLoading || !defaultCalendar) && <p className="gsw-calendar-header-status" role="status">{eventsLoading ? "Loading events…" : "No calendar selected"}</p>}
      {error && <p className="gsw-errors">{error}</p>}
      <div className="gsw-calendar-layout gsw-calendar-layout-full"><CalendarGrid events={events} loading={eventsLoading} month={month} selectedDay={selectedDay} view={view} onNavigate={navigatePeriod} onSelectDay={(day) => { setSelectedDay(day); setDayModal(day); }} onOpen={setSelectedEvent} /></div>
      {dayModal && <div className="gsw-modal-backdrop gsw-calendar-day-backdrop" onMouseDown={() => setDayModal(null)}><section className="gsw-calendar-day-modal" role="dialog" aria-modal="true" aria-label={`Events for ${dayModal.toLocaleDateString()}`} onMouseDown={(event) => event.stopPropagation()}><div className="gsw-calendar-day-modal-head"><div><p className="gsw-eyebrow">Full day</p><h2>{dayModal.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</h2></div><button className="gsw-secondary-btn" onClick={() => setDayModal(null)}>Close</button></div><div className="gsw-calendar-day-modal-actions"><button className="gsw-primary-btn" onClick={() => { openNew(dayModal); setDayModal(null); }}><Plus size={16} aria-hidden="true" /> Add event</button></div><div className="gsw-calendar-day-modal-events">{eventsLoading ? <div className="gsw-calendar-grid-event-skeletons"><CalendarEventSkeleton compact={false} /><CalendarEventSkeleton compact={false} /><CalendarEventSkeleton compact={false} /></div> : modalEvents.length ? modalEvents.map((event) => <article key={event.engineId} role="button" tabIndex={0} onClick={() => setSelectedEvent(event)} onKeyDown={(keyEvent) => { if (keyEvent.key === "Enter" || keyEvent.key === " ") setSelectedEvent(event); }}><div className="gsw-calendar-day-modal-time">{formatEventTime(event)}</div><div className="gsw-calendar-day-modal-copy"><h3>{event.title}</h3>{event.location && <p className="gsw-calendar-event-meta">{event.location}</p>}{event.description && <p className="gsw-calendar-event-preview">{event.description}</p>}{event.meetingLink && <span className="gsw-calendar-event-link-hint">Meeting link available</span>}</div><div className="gsw-calendar-day-modal-event-actions"><span>View details</span></div></article>) : <div className="gsw-calendar-day-empty"><strong>No events</strong><p>This day is open.</p></div>}</div></section></div>}
      {selectedEvent && <div className="gsw-modal-backdrop gsw-calendar-event-backdrop" onMouseDown={() => setSelectedEvent(null)}><section className="gsw-calendar-event-modal" role="dialog" aria-modal="true" aria-label={selectedEvent.title} onMouseDown={(event) => event.stopPropagation()}><div className="gsw-calendar-event-modal-head"><div><p className="gsw-eyebrow">Event details</p><h2>{selectedEvent.title}</h2><p>{new Date(selectedEvent.start).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })} · {formatEventTime(selectedEvent)}</p></div><button className="gsw-secondary-btn" onClick={() => setSelectedEvent(null)}>Back to day</button></div><div className="gsw-calendar-event-actionbar">{isPartnerMeeting(selectedEvent.meetingLink) && <button className="gsw-primary-btn" disabled={joiningHost} onClick={() => void hostMeeting(selectedEvent)}>{joiningHost ? "Opening…" : "Host meeting"}</button>}{selectedEvent.meetingLink && <a className="gsw-primary-btn" href={selectedEvent.meetingLink} target="_blank" rel="noreferrer"><ExternalLink size={15} /> Join meeting</a>}<button className="gsw-secondary-btn" onClick={() => openEdit(selectedEvent)}><Pencil size={15} /> Edit</button>{selectedEvent.attendees.length > 0 && <button className="gsw-secondary-btn" onClick={() => openAttendeeEmail(selectedEvent)}><Mail size={15} /> Email attendees</button>}<button className="gsw-secondary-btn" onClick={() => void copyEventDetails(selectedEvent)}>Copy details</button><button className="gsw-calendar-delete-action" onClick={() => void remove(selectedEvent)}><Trash2 size={15} /> Delete</button></div>{isPartnerMeeting(selectedEvent.meetingLink) && <section style={{padding:"12px 0"}}><button className="gsw-secondary-btn" disabled={loadingOwnerCode} onClick={() => void showOwnerCode()}>{loadingOwnerCode ? "Loading code…" : "Show organizer code"}</button>{eventOwnerCode && <p>Private organizer code: <strong style={{letterSpacing:"0.15em"}}>{eventOwnerCode}</strong><br /><small>Enter this one-time code under Organizer access on the meeting page. Keep it private.</small></p>}</section>}{hostError && <p role="alert">{hostError}</p>}<div className="gsw-calendar-event-details">{selectedEvent.location && <section><strong>Location</strong>{/^https?:\/\//.test(selectedEvent.location) ? <a href={selectedEvent.location} target="_blank" rel="noreferrer">{selectedEvent.location}</a> : <p>{selectedEvent.location}</p>}</section>}{selectedEvent.meetingLink && <section><strong>Meeting link</strong><a href={selectedEvent.meetingLink} target="_blank" rel="noreferrer">{selectedEvent.meetingLink}</a></section>}{selectedEvent.attendees.length > 0 && <section><strong>Attendees</strong><div className="gsw-calendar-rsvp-summary">{(() => { const accepted = rsvpStatuses.filter((item) => item.response === "accepted").length; return <span>{accepted} yes · {selectedEvent.attendees.length} invited</span>; })()}{rsvpLoading && <span>Refreshing responses…</span>}</div><div className="gsw-calendar-rsvp-list">{selectedEvent.attendees.map((attendee) => { const status = rsvpStatuses.find((item) => item.attendeeEmail.toLowerCase() === attendee.toLowerCase()); const response = status?.response ?? null; const label = response === "accepted" ? "Yes" : response === "declined" ? "No" : response === "tentative" ? "Maybe" : "Pending"; return <div className="gsw-calendar-rsvp-person" key={attendee}><span className="gsw-calendar-rsvp-email">{attendee}</span><span className={`gsw-calendar-rsvp-badge ${response ?? "pending"}`}>{label}</span></div>; })}</div></section>}{selectedEvent.description && <section><strong>Details</strong><p className="gsw-calendar-event-description"><LinkifiedText text={selectedEvent.description} /></p></section>}</div></section></div>}
      {emailEvent && <div className="gsw-modal-backdrop gsw-calendar-email-backdrop" onMouseDown={() => setEmailEvent(null)}><section className="gsw-calendar-email-modal" role="dialog" aria-modal="true" aria-label="Email attendees" onMouseDown={(event) => event.stopPropagation()}><div className="gsw-calendar-event-modal-head"><div><p className="gsw-eyebrow">GSW Mail</p><h2>Email attendees</h2><p>Choose who should receive the formatted meeting update.</p></div><button className="gsw-secondary-btn" onClick={() => setEmailEvent(null)}>Close</button></div><div className="gsw-calendar-email-recipients">{uniqueEmails(emailEvent.attendees).map((attendee) => <label key={attendee}><input type="checkbox" checked={emailRecipients.includes(attendee)} onChange={(event) => setEmailRecipients((current) => event.target.checked ? uniqueEmails([...current, attendee]) : current.filter((item) => item !== attendee))} /><span>{attendee}</span></label>)}</div><label className="gsw-calendar-email-add">Add an email or contact<div className="gsw-calendar-attendee-input"><input value={emailDraft} onChange={(event) => setEmailDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === ",") { event.preventDefault(); void addEmailRecipient(emailDraft); } }} placeholder="Name or person@example.com" /></div><small>Choose a contact below, or press Enter/comma to add an email.</small></label>{emailDraft.trim() && <div className="gsw-calendar-contact-suggestions">{contactOptions.flatMap((contact) => contact.emails.map((entry) => ({ name: contact.displayName || [contact.firstName, contact.lastName].filter(Boolean).join(" ") || entry.email, email: entry.email }))).filter((item) => `${item.name} ${item.email}`.toLowerCase().includes(emailDraft.trim().toLowerCase()) && !emailRecipients.includes(item.email.toLowerCase())).slice(0, 5).map((item) => <button type="button" key={item.email} onClick={() => { setEmailRecipients((current) => uniqueEmails([...current, item.email])); setEmailDraft(""); }}><strong>{item.name}</strong><span>{item.email}</span></button>)}</div>}{emailRecipients.filter((email) => !emailEvent.attendees.includes(email)).length > 0 && <div className="gsw-calendar-email-extra">{emailRecipients.filter((email) => !emailEvent.attendees.includes(email)).map((email) => <span key={email}>{email}<button type="button" onClick={() => setEmailRecipients((current) => current.filter((item) => item !== email))}>×</button></span>)}</div>}<div className="gsw-calendar-email-actions"><span>{emailRecipients.length} selected</span><button className="gsw-primary-btn" disabled={emailSending || emailRecipients.length === 0} onClick={() => void sendAttendeeUpdate()}>{emailSending ? "Sending…" : "Send update"}</button></div></section></div>}
      {formOpen && <div className="gsw-calendar-form"><div className="gsw-page-heading"><div><p className="gsw-eyebrow">{editingId ? "Update event" : "New event"}</p><h2>{editingId ? "Edit calendar event" : "Create calendar event"}</h2></div><button className="gsw-secondary-btn" onClick={closeForm}>Close</button></div><div className="gsw-calendar-form-grid"><label>Calendar<select value={form.calendarId} onChange={(event) => setForm({ ...form, calendarId: event.target.value })}>{calendars.map((calendar) => <option key={calendar.engineId} value={calendar.engineId}>{calendar.isDefault ? calendarTitle : calendar.name}</option>)}</select></label><label>Title<input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Event title" /></label><label>Starts<input type="datetime-local" value={form.start} onChange={(event) => setForm({ ...form, start: event.target.value })} /></label><label>Duration (minutes)<input type="number" min="1" value={form.durationMinutes} onChange={(event) => setForm({ ...form, durationMinutes: event.target.value })} /></label><label>Location<input value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} /></label><div className="gsw-calendar-meeting-field"><div className="gsw-calendar-meeting-label"><label htmlFor={meetingInputId}>Virtual meeting link</label><button type="button" className="gsw-calendar-generate-link" onClick={() => void generateMeeting()} disabled={generatingMeeting || saving || !account || Boolean(form.meetingLink.trim())} aria-controls={meetingInputId} aria-busy={generatingMeeting}>{generatingMeeting ? "Generating…" : "Generate"}</button></div><input id={meetingInputId} type="url" value={form.meetingLink} onChange={(event) => { setMeetingError(""); setForm({ ...form, meetingLink: event.target.value }); }} placeholder="https://meet.example.com/..." aria-describedby={meetingError ? `${meetingInputId}-error` : undefined} />{ownerCode && <p role="status">Private organizer code: <strong style={{letterSpacing:"0.15em"}}>{ownerCode}</strong><br /><small>Save this one-time code to enter as host from the meeting link. Expires 24 hours after the scheduled start. Keep it private; it is not included in invitations.</small></p>}{meetingError && <small id={`${meetingInputId}-error`} className="gsw-calendar-meeting-error" role="alert">{meetingError}</small>}</div><label>Invite attendees<div className="gsw-calendar-attendee-input">{form.attendees.map((attendee) => <span className="gsw-calendar-attendee-chip" key={attendee}>{attendee}<button type="button" aria-label={`Remove ${attendee}`} onClick={() => removeAttendee(attendee)}>×</button></span>)}<input value={form.attendeeDraft} onChange={(event) => setForm({ ...form, attendeeDraft: event.target.value })} onKeyDown={(event) => { if (event.key === "Enter" || event.key === ",") { event.preventDefault(); void addAttendees(form.attendeeDraft); } }} onBlur={() => { if (form.attendeeDraft.trim()) void addAttendees(form.attendeeDraft); }} placeholder={form.attendees.length ? "Add another email" : "person@example.com"} /></div><small>Type an email, then press Enter or comma. Valid addresses become attendee tiles.</small></label><label>Email reminders<select multiple aria-label="Email reminder times" value={form.emailReminderMinutes.map(String)} onChange={(event) => setForm({ ...form, emailReminderMinutes: Array.from(event.target.selectedOptions, option => Number(option.value)) })}><option value="10080">1 week before</option><option value="2880">2 days before</option><option value="1440">24 hours before</option><option value="120">2 hours before</option><option value="60">1 hour before</option><option value="30">30 minutes before</option><option value="15">15 minutes before</option></select><small>Hold Ctrl or Command to select multiple reminders. Clear selections to disable email reminders. Sent to your mailbox only.</small></label><label className="gsw-calendar-all-day"><input type="checkbox" checked={form.allDay} onChange={(event) => setForm({ ...form, allDay: event.target.checked })} /> All day</label></div><label>Description<textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /><label className="gsw-calendar-invitations"><input type="checkbox" checked={form.sendInvitations} onChange={(event) => setForm({ ...form, sendInvitations: event.target.checked })} /> Send invitation or update emails through GSW Mail when this event is saved</label><button className="gsw-primary-btn" disabled={saving || generatingMeeting || !form.calendarId || !form.title.trim()} onClick={() => void save()}>{saving ? "Saving..." : editingId ? "Save changes" : "Create event"}</button></label></div>}
    </main></div>);
}


function eventTouchesDay(event: CalendarEvent, day: Date): boolean {
  const key = dateKey(day);
  if (event.allDay) {
    const first = event.start.slice(0, 10);
    const last = event.end?.slice(0, 10);
    return key >= first && (last && last > first ? key < last : key === first);
  }
  const first = new Date(day.getFullYear(), day.getMonth(), day.getDate());
  const last = new Date(first); last.setDate(last.getDate() + 1);
  const start = new Date(event.start).getTime();
  const end = event.end ? new Date(event.end).getTime() : start + 60 * 60_000;
  return start < last.getTime() && Math.max(end, start + 60_000) > first.getTime();
}

function timedDayEvents(events: CalendarEvent[], day: Date) {
  const first = new Date(day.getFullYear(), day.getMonth(), day.getDate());
  const last = new Date(first); last.setDate(last.getDate() + 1);
  const items = events.filter(event => !event.allDay && eventTouchesDay(event, day)).map(event => {
    const start = new Date(event.start);
    const end = event.end ? new Date(event.end) : new Date(start.getTime() + 60 * 60_000);
    const from = start < first ? 0 : start.getHours() * 60 + start.getMinutes();
    const until = end >= last ? 1440 : end.getHours() * 60 + end.getMinutes();
    return { event, from, until: Math.min(1440, Math.max(from + 20, until)), lane: 0, lanes: 1 };
  }).sort((a, b) => a.from - b.from || b.until - a.until);
  let group: typeof items = [];
  let ends: number[] = [];
  let groupEnd = -1;
  const finish = () => { group.forEach(item => { item.lanes = ends.length; }); };
  for (const item of items) {
    if (item.from >= groupEnd) { finish(); group = []; ends = []; groupEnd = -1; }
    let lane = ends.findIndex(end => end <= item.from);
    if (lane === -1) lane = ends.length;
    ends[lane] = item.until;
    item.lane = lane;
    group.push(item);
    groupEnd = Math.max(groupEnd, item.until);
  }
  finish();
  return items;
}

function CalendarGrid({ events, loading, month, selectedDay, view, onSelectDay, onOpen, onNavigate }: {
  events: CalendarEvent[]; loading: boolean; month: Date; selectedDay: Date; view: CalendarView;
  onSelectDay: (day: Date) => void; onOpen: (event: CalendarEvent) => void; onNavigate: (direction: number) => void;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  const firstDay = view === "week" ? startOfWeek(selectedDay) : selectedDay;
  const firstKey = dateKey(firstDay);
  useEffect(() => { if (view !== "month" && scroll.current) scroll.current.scrollTop = 8 * 56; }, [view, firstKey]);
  if (view === "month") {
    const dates = monthGridDates(month);
    return <section className="gsw-calendar-grid gsw-calendar-grid-month" style={{ gridTemplateRows: `repeat(${dates.length / 7}, minmax(90px, 1fr))` }} aria-busy={loading}>
      {dates.map((day, index) => {
        const key = dateKey(day);
        const dayEvents = events.filter(event => eventTouchesDay(event, day));
        const outside = day.getMonth() !== month.getMonth() || day.getFullYear() !== month.getFullYear();
        return <div className={`gsw-calendar-day${outside ? " gsw-calendar-day-outside-month" : ""}`} key={key} onClick={() => onSelectDay(day)}>
          <header><button type="button" aria-label={`Open events for ${day.toLocaleDateString()}`} onClick={click => { click.stopPropagation(); onSelectDay(day); }}>{day.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</button></header>
          <div className="gsw-calendar-month-events">{loading ? <>{index % 3 === 0 && <CalendarEventSkeleton />}</> : <>{dayEvents.slice(0, 2).map(event => <div className="gsw-calendar-month-event" key={event.engineId}><time>{event.allDay ? "All day" : new Date(event.start).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time><span>{event.title}</span></div>)}{dayEvents.length > 2 && <div className="gsw-calendar-more-events">+{dayEvents.length - 2} more</div>}</>}</div>
        </div>;
      })}
    </section>;
  }
  const dates = view === "day" ? [selectedDay] : Array.from({ length: 7 }, (_, index) => { const day = startOfWeek(selectedDay); day.setDate(day.getDate() + index); return day; });
  const hasAllDay = dates.some(day => events.some(event => event.allDay && eventTouchesDay(event, day)));
  const columns = `58px repeat(${dates.length}, minmax(${view === "week" ? "110px" : "0px"}, 1fr))`;
  return <section className="gsw-calendar-timeline" aria-label={`${view} calendar`} aria-busy={loading}>
    <div className="gsw-calendar-timeline-scroll" ref={scroll}>
      <div className="gsw-calendar-timeline-heading" style={{ gridTemplateColumns: columns, minWidth: view === "week" ? 828 : undefined }}>
        <div className="gsw-calendar-timezone">{hasAllDay ? "All day" : "Time"}</div>
        {dates.map(day => <div className="gsw-calendar-timeline-day-head" key={dateKey(day)}>
          <button type="button" onClick={() => onSelectDay(day)} aria-label={`Open events for ${day.toLocaleDateString()}`}>{day.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</button>
          {hasAllDay && <div className="gsw-calendar-all-day-events">{events.filter(event => event.allDay && eventTouchesDay(event, day)).map(event => <button type="button" className="gsw-calendar-all-day-event" key={event.engineId} title={event.title} onClick={() => onOpen(event)}>{event.title}</button>)}</div>}
        </div>)}
      </div>
      <div className="gsw-calendar-timeline-body" style={{ gridTemplateColumns: columns, minWidth: view === "week" ? 828 : undefined }}>
        <div className="gsw-calendar-hours" aria-hidden="true">{Array.from({ length: 24 }, (_, hour) => <div key={hour}>{new Date(2000, 0, 1, hour).toLocaleTimeString([], { hour: "numeric" })}</div>)}</div>
        {dates.map(day => <div className="gsw-calendar-time-column" key={dateKey(day)} onClick={() => onSelectDay(day)}>
          {Array.from({ length: 24 }, (_, hour) => <div className="gsw-calendar-hour-line" key={hour} aria-hidden="true" />)}
          {!loading && timedDayEvents(events, day).map(item => <button type="button" className="gsw-calendar-timed-event" key={item.event.engineId} title={`${item.event.title} · ${formatEventTime(item.event)}`}
            style={{ top: item.from / 60 * 56, height: Math.max(18, (item.until - item.from) / 60 * 56), left: `calc(${item.lane / item.lanes * 100}% + 3px)`, width: `calc(${100 / item.lanes}% - 6px)` }}
            onClick={click => { click.stopPropagation(); onOpen(item.event); }}>
            <strong>{item.event.title}</strong><time>{new Date(item.event.start).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time>
          </button>)}
        </div>)}
      </div>
    </div>
    <button type="button" className="gsw-calendar-edge-nav gsw-calendar-edge-prev" aria-label={`Previous ${view}`} title={`Previous ${view}`} onClick={() => onNavigate(-1)}><ChevronLeft size={22} aria-hidden="true" /></button>
    <button type="button" className="gsw-calendar-edge-nav gsw-calendar-edge-next" aria-label={`Next ${view}`} title={`Next ${view}`} onClick={() => onNavigate(1)}><ChevronRight size={22} aria-hidden="true" /></button>
  </section>;
}
