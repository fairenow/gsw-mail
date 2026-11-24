import { useEffect, useState } from "react";
import type { SavedEventLink } from "../booking";
import { Check, Copy, Plus, X } from "lucide-react";
import { api, type Account } from "../api";

type Meeting = { joinUrl: string; ownerCode: string; ownerCodeExpiresAt: string };
export function QuickMeetingLink({ account }: { account: Account | null }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [copied, setCopied] = useState<"link" | "code" | "booking" | null>(null);
  const [bookingLinks, setBookingLinks] = useState<SavedEventLink[]>([]);
  const [selectedBookingId, setSelectedBookingId] = useState("");
  const [bookingLoading, setBookingLoading] = useState(false);
  const [bookingError, setBookingError] = useState("");
  useEffect(() => {
    if (!open || !account?.permissions.includes("manage")) {
      setBookingLinks([]);
      setSelectedBookingId("");
      setBookingError("");
      return;
    }
    let active = true;
    setBookingLoading(true);
    setBookingError("");
    void api.eventLinks(account.id).then(({ links }) => {
      if (!active) return;
      const enabled = links.filter(link => link.enabled);
      setBookingLinks(enabled);
      setSelectedBookingId(previous => enabled.some(link => link.id === previous) ? previous : (enabled[0]?.id ?? ""));
    }).catch(() => {
      if (active) setBookingError("Could not load your booking links. Open Events to access them.");
    }).finally(() => {
      if (active) setBookingLoading(false);
    });
    return () => { active = false; };
  }, [open, account?.id, account?.permissions.includes("manage")]);
  const bookingLink = bookingLinks.find(link => link.id === selectedBookingId);
  const create = async () => {
    if (!account || busy) return;
    setBusy(true);
    setError("");
    setMeeting(null);
    try {
      const result = await api.createPrivateMeeting({
        accountId: account.id,
        externalEventId: crypto.randomUUID(),
        title: "Quick meeting",
        scheduledAt: new Date(Date.now() + 5 * 60_000).toISOString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Etc/UTC",
      });
      const url = new URL(result.joinUrl);
      if (url.origin !== "https://bible.guidedstepswellness.com" || !/^\/meet\/[a-zA-Z0-9_-]+$/.test(url.pathname) || url.search || url.hash) throw new Error("Unexpected meeting link returned.");
      if (!/^[0-9]{8}$/.test(result.ownerCode)) throw new Error("Invalid organizer code.");
      setMeeting(result);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not create meeting.");
    } finally {
      setBusy(false);
    }
  };
  const copy = async (value: string, what: "link" | "code" | "booking") => {
    try { await navigator.clipboard.writeText(value); setCopied(what); }
    catch { setError("Copy failed. Select and copy the text manually."); }
  };
  return <>
    <button type="button" className="gsw-quick-meeting-button" onClick={() => { setOpen(true); setMeeting(null); setError(""); setCopied(null); void create(); }} disabled={!account} aria-label="Create meeting link" title="Create meeting link">
      <Plus size={17}/><span>Meeting Link</span>
    </button>
    {open && <div className="gsw-quick-meeting-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setOpen(false); }}>
      <section className="gsw-quick-meeting-modal" role="dialog" aria-modal="true" aria-label="New meeting link">
        <div className="gsw-quick-meeting-head"><h2>New meeting link</h2><button type="button" onClick={() => setOpen(false)} aria-label="Close"><X size={20}/></button></div>
        {busy ? <p>Creating your private meeting…</p> : meeting ? <>
          <p>Share the meeting link with guests. Keep the organizer code private.</p>
          {([["link", "Meeting link", meeting.joinUrl], ["code", "Organizer code", meeting.ownerCode]] as const).map(([key,label,value]) => <label key={key} className="gsw-quick-meeting-field">{label}<span><input readOnly value={value} onFocus={event => event.currentTarget.select()} /><button type="button" title={"Copy " + label.toLowerCase()} aria-label={"Copy " + label.toLowerCase()} onClick={() => void copy(value,key)}>{copied === key ? <Check size={18}/> : <Copy size={18}/>}</button></span></label>)}
          <small>Organizer codes are sensitive, one-time credentials. Do not include them in guest invitations.</small>
          {account?.permissions.includes("manage") && <div className="gsw-quick-meeting-booking">
            <strong>Event booking link</strong>
            <p>Share your calendar booking page so guests can schedule another meeting with you.</p>
            {bookingLoading ? <small>Loading booking links…</small> : bookingError ? <small role="status">{bookingError}</small> : bookingLink ? <>
              {bookingLinks.length > 1 && <label className="gsw-quick-meeting-field">Booking page
                <select aria-label="Choose event booking link" value={selectedBookingId} onChange={event => { setSelectedBookingId(event.target.value); setCopied(null); }}>
                  {bookingLinks.map(link => <option key={link.id} value={link.id}>{link.name}</option>)}
                </select>
              </label>}
              <label className="gsw-quick-meeting-field">Your event booking URL
                <span><input readOnly value={bookingLink.url} onFocus={event => event.currentTarget.select()} />
                  <button type="button" title="Copy event booking link" aria-label="Copy event booking link" onClick={() => void copy(bookingLink.url,"booking")}>{copied === "booking" ? <Check size={18}/> : <Copy size={18}/>}</button>
                </span>
              </label>
            </> : <small>No active booking link yet. Create one in Events to share it here.</small>}
          </div>}
          <button type="button" className="gsw-quick-meeting-retry" onClick={() => void create()}>Create another link</button>
        </> : <button type="button" className="gsw-quick-meeting-retry" onClick={() => void create()}>Retry meeting creation</button>}
        {error && <p role="alert" style={{color:"#ad3434"}}>{error}</p>}
      </section>
    </div>}
  </>;
}
