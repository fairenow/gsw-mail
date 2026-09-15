import { useEffect, useState } from "react";
import { api, type CalendarEvent } from "../api";
import { useAppShell } from "../components/AppShell";
import { MailWorkspace } from "../components/MailWorkspace";

const monthStart = (date: Date) => new Date(date.getFullYear(), date.getMonth(), 1);
const monthEnd = (date: Date) => new Date(date.getFullYear(), date.getMonth() + 1, 1);

export function CalendarPage() {
  const { account, configureTopBar } = useAppShell();
  const [month, setMonth] = useState(() => monthStart(new Date()));
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [calendars, setCalendars] = useState<Awaited<ReturnType<typeof api.calendars>>["calendars"]>([]);
  const [error, setError] = useState("");

  useEffect(() => { configureTopBar({ search: "", searchPlaceholder: "Search mail", searchDisabled: true }); }, [configureTopBar]);
  useEffect(() => {
    if (!account) return;
    const after = monthStart(month).toISOString();
    const before = monthEnd(month).toISOString();
    void Promise.all([api.calendars(account.id), api.calendarEvents(account.id, after, before)]).then(([calendarResult, eventResult]) => {
      setCalendars(calendarResult.calendars);
      setEvents(eventResult.events.sort((a, b) => a.start.localeCompare(b.start)));
      setError("");
    }).catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [account, month]);

  return <MailWorkspace section="calendar"><div className="gsw-product-shell"><main className="gsw-calendar-page">
      <div className="gsw-page-heading"><div><p className="gsw-eyebrow">Connected to {account?.address ?? "your mailbox"}</p><h1>Calendar</h1><p>Events from the calendars connected to this Stalwart account.</p></div><div className="gsw-calendar-controls"><button className="gsw-secondary-btn" onClick={() => setMonth((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))}>Previous</button><strong>{month.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</strong><button className="gsw-secondary-btn" onClick={() => setMonth((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))}>Next</button></div></div>
      {error && <p className="gsw-errors">{error}</p>}
      <div className="gsw-calendar-layout"><aside className="gsw-calendar-list"><h2>Calendars</h2>{calendars.length ? calendars.map((calendar) => <div key={calendar.engineId}><span className="gsw-calendar-dot" style={{ background: calendar.color ?? "var(--gsw-accent)" }} />{calendar.name}</div>) : <p>No calendars available.</p>}</aside><section className="gsw-event-list">{events.length ? events.map((event) => <article key={event.engineId}><time>{event.allDay ? "All day" : new Date(event.start).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time><div><h2>{event.title}</h2>{event.location && <p>{event.location}</p>}{event.description && <p>{event.description}</p>}</div></article>) : <div className="gsw-empty-product"><strong>No events this month</strong><p>Your Stalwart calendars have no events in this range.</p></div>}</section></div>
    </main></div></MailWorkspace>;
}
