import { useEffect, useState } from "react";
type Preview = {
  title: string;
  name: string;
  email: string;
  start: string;
  timeZone: string;
  status: string;
  expiresAt: string;
};
async function request<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`/product/event-links/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    referrerPolicy: "no-referrer",
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error || "Could not process this booking.");
  return data as T;
}
export function BookingDecisionPage() {
  const [params] = useState(
    () => new URLSearchParams(window.location.hash.slice(1)),
  );
  const token = params.get("token") ?? "";
  const choice = params.get("choice") === "decline" ? "decline" : "approve";
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState("");
  useEffect(() => {
    let active = true;
    if (!token) {
      setError(
        "This approval link is missing information. Open the link from your booking email.",
      );
      return;
    }
    void request<Preview>("decision-preview", { token })
      .then((data) => {
        if (active) setPreview(data);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [token]);
  const decide = async () => {
    setBusy(true);
    setError("");
    try {
      await request("decision", { token, decision: choice });
      setDone(
        choice === "approve"
          ? "Booking approved. The calendar event and confirmation emails are being prepared."
          : "Booking declined. Notification emails are queued.",
      );
      window.history.replaceState({}, "", "/booking/decision");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not process booking.");
    } finally {
      setBusy(false);
    }
  };
  const actionable =
    preview &&
    (preview.status === "pending" ||
      (preview.status === "attention" && choice === "decline")) &&
    Date.parse(preview.expiresAt) > Date.now();
  return (
    <main className="gsw-rsvp-page">
      <section className="gsw-rsvp-card">
        <header className="gsw-rsvp-brand">
          <strong>GSW Mail · Booking request</strong>
        </header>
        <h1>
          {done
            ? "Response recorded"
            : choice === "approve"
              ? "Approve this booking?"
              : "Decline this booking?"}
        </h1>
        {error && <p role="alert">{error}</p>}
        {done ? (
          <p role="status">{done}</p>
        ) : preview ? (
          <>
            <h2>{preview.title}</h2>
            <p>
              {preview.name} · {preview.email}
            </p>
            <p>
              {new Intl.DateTimeFormat("en-US", {
                dateStyle: "full",
                timeStyle: "short",
                timeZone: preview.timeZone,
              }).format(new Date(preview.start))}{" "}
              ({preview.timeZone})
            </p>
            {actionable ? (
              <>
                <p>
                  Your choice is only recorded when you press the button below.
                </p>
                <button
                  className="gsw-primary-btn"
                  disabled={busy}
                  onClick={() => void decide()}
                >
                  {busy
                    ? "Saving…"
                    : choice === "approve"
                      ? "Confirm approval"
                      : "Confirm decline"}
                </button>
              </>
            ) : (
              <p role="status">
                This request is {preview.status}. It can no longer be{" "}
                {choice === "approve" ? "approved" : "declined"} through this
                link.
              </p>
            )}
          </>
        ) : (
          !error && <p role="status">Loading booking…</p>
        )}
        <p>
          <a href="/calendar">Open calendar</a> ·{" "}
          <a href="/mail">Return to mail</a>
        </p>
      </section>
    </main>
  );
}
