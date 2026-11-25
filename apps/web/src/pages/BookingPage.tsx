import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import type { BookingSlots, PublicEventLink } from "../booking";
const monthLabel = (month: string) =>
  new Date(month + "-01T12:00:00").toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
function changeMonth(month: string, delta: number) {
  const d = new Date(month + "-01T12:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + delta);
  return d.toISOString().slice(0, 7);
}
const displayDuration = (n: number) => (n === 60 ? "1 hour" : `${n} minutes`);
export function BookingPage() {
  const slug = decodeURIComponent(window.location.pathname.split("/")[2] ?? "");
  const community=useMemo(()=>{
   const params=new URLSearchParams(window.location.hash.slice(1)),id=params.get("registration"),proof=params.get("proof");
   if(!id||!proof||!/^[a-f0-9-]{36}$/i.test(id)||!/^\d{13}\.[A-Za-z0-9_-]{43}$/.test(proof))return null;
   return {id,proof};
  },[]);
  const [link, setLink] = useState<PublicEventLink | null>(null),
    [month, setMonth] = useState(""),
    [duration, setDuration] = useState(30),
    [slots, setSlots] = useState<BookingSlots | null>(null),
    [day, setDay] = useState(""),
    [start, setStart] = useState(""),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [attempt, setAttempt] = useState(0),
    [success, setSuccess] = useState("");
  const [guest, setGuest] = useState({
      name: "",
      email: "",
      phone: "",
      message: "",
      website: "",
    }),
    [visitorZone, setVisitorZone] = useState(
      Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    );
  const zones = useMemo(() => {
    const supported = (
      Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] }
    ).supportedValuesOf?.("timeZone") ?? [
      "UTC",
      "America/Detroit",
      "America/Chicago",
      "America/Los_Angeles",
      "Europe/London",
    ];
    return [...new Set([visitorZone, "UTC", ...supported])];
  }, []);
  const requestId = useMemo(
    () => community?.id??crypto.randomUUID(),
    [community,start, duration, guest.name, guest.email, guest.phone, guest.message],
  );
  useEffect(() => {
    let active = true;
    void api
      .publicEventLink(slug)
      .then((l) => {
        if (active) {
          setLink(l);
          setMonth(l.first.slice(0, 7));
          setDuration(
            l.mode === "fixed"
              ? l.duration
              : l.allowedDurations.includes(30)
                ? 30
                : l.allowedDurations[0]!,
          );
        }
      })
      .catch((e) => {
        if (active) {
          setError(e.message);
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [slug]);
  useEffect(() => {
    if (!link || !month) return;
    let active = true;
    setLoading(true);
    setSlots(null);
    setDay("");
    setStart("");
    setError("");
    void api
      .publicBookingSlots(slug, month, duration)
      .then((s) => {
        if (active) setSlots(s);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [link, month, duration, slug, attempt]);
  useEffect(() => {
    if (!success||community) return;
    const timer = window.setTimeout(
      () => window.location.assign("https://mail.guidedstepswellness.com"),
      15000,
    );
    return () => window.clearTimeout(timer);
  }, [success,community]);
  const submit = async () => {
    if (!start) return;
    setBusy(true);
    setError("");
    try {
      const result = await api.submitBooking(slug, {
        requestId,
        start,
        duration,
        ...guest,
        ...(community?{communityProof:community.proof}:{}),
      });
      if (
        !["pending", "approved", "creating", "confirmed"].includes(
          result.status,
        )
      )
        throw new Error(
          "This request could not be confirmed. Refresh availability and choose another time.",
        );
      setSuccess(result.status);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not submit booking");
    } finally {
      setBusy(false);
    }
  };
  const firstOffset = month ? new Date(month + "-01T12:00:00Z").getUTCDay() : 0;
  const count = month
    ? new Date(Number(month.slice(0, 4)), Number(month.slice(5)), 0).getDate()
    : 0;
  const slotTime = (s: string) =>
    new Date(s).toLocaleString(undefined, {
      timeZone: visitorZone,
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  return (
    <div className="booking-page">
      <header className="booking-brand">
        <a href="/">GSW Mail</a>
        <span>Event Link</span>
      </header>
      <main className="booking-card" data-private>
        {success ? (
          <section className="booking-success" role="status">
            <span className="booking-success-mark" aria-hidden="true">
              ✓
            </span>
            <h1>
              {success === "pending"
                ? "Your request has been sent for approval."
                : success === "confirmed"
                  ? "Your booking is confirmed."
                  : "Your booking has been received."}
            </h1>
            <p>
              {success === "pending"
                ? "You will receive a request receipt by email. A final confirmation follows when the organizer approves."
                : "Your time is reserved. A confirmation email will follow after the calendar event is created."}
            </p>
            <p>
              {start &&
                new Date(start).toLocaleString(undefined, {
                  timeZone: visitorZone,
                  dateStyle: "full",
                  timeStyle: "short",
                })}{" "}
              · {displayDuration(duration)}
            </p>
            <p>
              {community?"Check your inbox and return to your Community registration when you are ready.":"Check your inbox and spam folder. You’ll return to the GSW Mail home page in 15 seconds."}
            </p>
            <a
              className="gsw-primary-btn"
              href="https://mail.guidedstepswellness.com"
            >
              Return to GSW Mail
            </a>
          </section>
        ) : (
          <>
            <section className="booking-intro">
              <p className="gsw-eyebrow">{community?"COMMUNITY APPOINTMENT":"BOOK A MEETING"}</p>{community&&<p>Use the same email address as your Community registration.</p>}
              <h1>{link?.name ?? "Schedule a meeting"}</h1>
              {link && (
                <>
                  <p>
                    {link.mode === "fixed"
                      ? displayDuration(link.duration)
                      : "Choose the time and meeting length you need."}
                  </p>
                  {link.location && <p>{link.location}</p>}
                  <p>
                    {link.approval === "manual"
                      ? "Your booking requires organizer approval."
                      : "Available bookings are automatically approved."}
                  </p>
                  <label>
                    Your timezone
                    <select
                      value={visitorZone}
                      onChange={(e) => setVisitorZone(e.target.value)}
                    >
                      {zones.map((z) => (
                        <option key={z}>{z}</option>
                      ))}
                    </select>
                  </label>
                  <p className="booking-timezone-note">
                    Calendar dates follow the organizer’s timezone:{" "}
                    {link.timeZone}. Time buttons show your timezone.
                  </p>
                </>
              )}
            </section>
            <section className="booking-main" aria-busy={loading}>
              {error && (
                <div className="event-link-notice" role="alert">
                  <p>{error}</p>
                  {link && (
                    <button
                      className="gsw-secondary-btn"
                      disabled={loading || busy}
                      onClick={() => setAttempt((n) => n + 1)}
                    >
                      Refresh availability
                    </button>
                  )}
                </div>
              )}
              {link && (
                <>
                  {link.mode === "windows" && (
                    <label>
                      Meeting length
                      <select
                        value={duration}
                        disabled={busy}
                        onChange={(e) => setDuration(Number(e.target.value))}
                      >
                        {link.allowedDurations.map((n) => (
                          <option key={n} value={n}>
                            {displayDuration(n)}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <div className="booking-month-heading">
                    <button
                      aria-label="Previous month"
                      disabled={busy || month <= link.first.slice(0, 7)}
                      onClick={() => setMonth((m) => changeMonth(m, -1))}
                    >
                      ‹
                    </button>
                    <h2>{monthLabel(month)}</h2>
                    <button
                      aria-label="Next month"
                      disabled={busy || month >= link.last.slice(0, 7)}
                      onClick={() => setMonth((m) => changeMonth(m, 1))}
                    >
                      ›
                    </button>
                  </div>
                  <div
                    className="booking-calendar"
                    role="group"
                    aria-label={`${monthLabel(month)} availability`}
                  >
                    <div className="booking-weekdays" aria-hidden="true">
                      {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(
                        (d) => (
                          <span key={d}>{d}</span>
                        ),
                      )}
                    </div>
                    <div className="booking-days">
                      {Array.from({ length: firstOffset }, (_, i) => (
                        <span key={`blank-${i}`} />
                      ))}
                      {Array.from({ length: count }, (_, i) => {
                        const date =
                            month + "-" + String(i + 1).padStart(2, "0"),
                          available = !!slots?.days[date]?.length;
                        return (
                          <button
                            key={date}
                            disabled={!available || loading || busy}
                            aria-label={`${new Date(date + "T12:00:00Z").toLocaleDateString(undefined, { timeZone: "UTC", dateStyle: "full" })}${available ? ", available" : ", unavailable"}`}
                            aria-pressed={day === date}
                            className={
                              day === date
                                ? "selected"
                                : available
                                  ? "available"
                                  : ""
                            }
                            onClick={() => {
                              setDay(date);
                              setStart("");
                            }}
                          >
                            {i + 1}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  {loading ? (
                    <p role="status">Checking available times…</p>
                  ) : !Object.values(slots?.days ?? {}).some((s) => s.length) &&
                    !error ? (
                    <p>
                      No available times this month. Try the next month or
                      another meeting length.
                    </p>
                  ) : null}
                  {day && (
                    <section className="booking-times">
                      <h3>
                        Available times ·{" "}
                        {new Date(day + "T12:00:00Z").toLocaleDateString(
                          undefined,
                          { timeZone: "UTC", month: "long", day: "numeric" },
                        )}
                      </h3>
                      <p>
                        {visitorZone} · {displayDuration(duration)}
                      </p>
                      <div className="booking-time-options">
                        {slots?.days[day]?.map((s) => (
                          <button
                            key={s.start}
                            disabled={busy}
                            aria-pressed={start === s.start}
                            className={start === s.start ? "selected" : ""}
                            onClick={() => setStart(s.start)}
                          >
                            {slotTime(s.start)}
                          </button>
                        ))}
                      </div>
                    </section>
                  )}
                  {start && (
                    <form
                      className="booking-guest"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void submit();
                      }}
                    >
                      <h3>Your details</h3>
                      <p>
                        {slotTime(start)} · {displayDuration(duration)} ·{" "}
                        {visitorZone}
                      </p>
                      <fieldset disabled={busy}>
                        <label>
                          Name
                          <input
                            required
                            autoComplete="name"
                            maxLength={100}
                            value={guest.name}
                            onChange={(e) =>
                              setGuest((g) => ({ ...g, name: e.target.value }))
                            }
                          />
                        </label>
                        <label>
                          Email
                          <input
                            required
                            type="email"
                            autoComplete="email"
                            maxLength={254}
                            value={guest.email}
                            onChange={(e) =>
                              setGuest((g) => ({ ...g, email: e.target.value }))
                            }
                          />
                        </label>
                        <label>
                          Phone number{" "}
                          {link.phoneRequired ? "(required)" : "(optional)"}
                          <input
                            required={link.phoneRequired}
                            type="tel"
                            autoComplete="tel"
                            maxLength={50}
                            value={guest.phone}
                            onChange={(e) =>
                              setGuest((g) => ({ ...g, phone: e.target.value }))
                            }
                          />
                        </label>
                        <label>
                          Message{" "}
                          {link.messageRequired ? "(required)" : "(optional)"}
                          <textarea
                            required={link.messageRequired}
                            maxLength={2000}
                            rows={4}
                            value={guest.message}
                            onChange={(e) =>
                              setGuest((g) => ({
                                ...g,
                                message: e.target.value,
                              }))
                            }
                          />
                        </label>
                        <div className="booking-trap" aria-hidden="true">
                          <label>
                            Website
                            <input
                              tabIndex={-1}
                              autoComplete="off"
                              value={guest.website}
                              onChange={(e) =>
                                setGuest((g) => ({
                                  ...g,
                                  website: e.target.value,
                                }))
                              }
                            />
                          </label>
                        </div>
                        <p>
                          Submitting shares your details with the organizer and
                          sends booking emails to you both.
                        </p>
                        <button className="gsw-primary-btn" type="submit">
                          {busy
                            ? "Submitting…"
                            : link.approval === "manual"
                              ? "Request booking"
                              : "Book meeting"}
                        </button>
                      </fieldset>
                    </form>
                  )}
                </>
              )}
              {!link && loading && <p role="status">Loading booking page…</p>}
            </section>
          </>
        )}
      </main>
      <footer className="booking-footer">
        Powered by <a href="https://mail.guidedstepswellness.com">GSW Mail</a>
        <span> · </span>
        <a href="/privacy">Privacy</a>
      </footer>
    </div>
  );
}
