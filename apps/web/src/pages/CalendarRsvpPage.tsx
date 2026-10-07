import { useEffect, useMemo, useState } from "react";
import { CalendarCheck, CalendarClock, MapPin, Video } from "lucide-react";
import { api, type CalendarRsvpPublic, type CalendarRsvpResponse } from "../api";

const responseLabel: Record<CalendarRsvpResponse, string> = {
  accepted: "Yes",
  declined: "No",
  tentative: "Maybe",
};

const statusCopy: Record<CalendarRsvpResponse, string> = {
  accepted: "You’re going.",
  declined: "You’re not attending.",
  tentative: "You may attend.",
};

export function CalendarRsvpPage() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const token = params.get("token") ?? "";
  const requested = params.get("choice");
  const requestedResponse = requested === "accepted" || requested === "declined" || requested === "tentative" ? requested : null;
  const [invite, setInvite] = useState<CalendarRsvpPublic | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState<CalendarRsvpResponse | null>(null);

  useEffect(() => {
    if (!token) {
      setError("This RSVP link is missing information.");
      return;
    }
    let cancelled = false;
    void api.calendarRsvpPublic(token).then((value) => {
      if (cancelled) return;
      setInvite(value);
    }).catch((err) => {
      if (!cancelled) setError(err instanceof Error ? err.message : String(err));
    });
    return () => { cancelled = true; };
  }, [token]);

  const respond = async (response: CalendarRsvpResponse) => {
    if (!token) return;
    setSaving(response);
    setError("");
    try {
      setInvite(await api.respondCalendarRsvp(token, response));
      const url = new URL(window.location.href);
      url.searchParams.delete("choice");
      window.history.replaceState({}, "", url);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(null);
    }
  };

  const start = invite ? new Date(invite.eventStart) : null;
  const end = invite?.eventEnd ? new Date(invite.eventEnd) : null;
  const timeText = start ? start.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) + (end ? " – " + end.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "") : "";

  return <main className="gsw-rsvp-page">
    <section className="gsw-rsvp-card">
      <header className="gsw-rsvp-brand">
        <img src="/guided_steps_logo.png" alt="GSW Mail" />
        <div><strong>GSW Mail</strong><span>Calendar invitation</span></div>
      </header>

      {error ? <div className="gsw-rsvp-error"><h1>We couldn’t open this invitation.</h1><p>{error}</p></div> : !invite ? <div className="gsw-rsvp-loading"><span /><span /><span /></div> : <>
        <div className="gsw-rsvp-heading">
          <p>You’re invited</p>
          <h1>{invite.eventTitle}</h1>
          <span>For {invite.attendeeEmail}</span>
        </div>

        <div className="gsw-rsvp-details">
          <div><CalendarClock size={19} /><span><strong>{start?.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</strong>{start && <small>{timeText}</small>}</span></div>
          {invite.eventLocation && <div><MapPin size={19} /><span><strong>Location</strong><small>{invite.eventLocation}</small></span></div>}
          {invite.meetingLink && <div><Video size={19} /><span><strong>Online meeting</strong><a href={invite.meetingLink} target="_blank" rel="noreferrer">Join meeting</a></span></div>}
        </div>

        {invite.response ? <div className="gsw-rsvp-status"><CalendarCheck size={20} /><div><strong>{statusCopy[invite.response]}</strong><span>You can change your response below.</span></div></div> : requestedResponse ? <div className="gsw-rsvp-status"><CalendarCheck size={20} /><div><strong>Confirm {responseLabel[requestedResponse]}</strong><span>Your response is not recorded until you press the button below.</span></div></div> : null}

        <div className="gsw-rsvp-actions" aria-label="RSVP response">
          {(["accepted", "declined", "tentative"] as CalendarRsvpResponse[]).map((response) => <button key={response} className={(invite.response ?? requestedResponse) === response ? "active" : ""} disabled={saving !== null} onClick={() => void respond(response)}>{saving === response ? "Saving…" : responseLabel[response]}</button>)}
        </div>

        <p className="gsw-rsvp-footnote">Your response is recorded securely by GSW Mail. You can return to this link later to change it while the invitation is active.</p>
      </>}
    </section>
  </main>;
}
