import { useEffect, useState } from "react";
import { api, type Account, type CalendarSummary } from "../api";
import {
  meetingDurations,
  type EventLinkSettingsData,
  type SavedEventLink,
} from "../booking";
import { useAppShell } from "./AppShell";
const dayNames = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const minutes = (n: number) => (n === 60 ? "1 hour" : `${n} minutes`);
const defaults = (): EventLinkSettingsData => ({
  name: "",
  slug: "",
  calendarId: "",
  timeZone:
    Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Detroit",
  enabled: true,
  mode: "windows",
  duration: 30,
  allowedDurations: [15, 20, 30, 45, 60],
  windows: [1, 2, 3, 4, 5].map((day) => ({
    day,
    start: "09:00",
    end: "17:00",
  })),
  fixedSlots: [],
  unavailableDates: [],
  approval: "manual",
  phoneRequired: false,
  messageRequired: false,
  noticeHours: 4,
  location: "",
  meetingUrl: "",
  generateMeeting: false,
});
export function EventLinkSettings() {
  const { account } = useAppShell();
  return account ? (
    <MailboxEventLinks key={account.id} account={account} />
  ) : (
    <p>Select a mailbox to manage event links.</p>
  );
}
function MailboxEventLinks({ account }: { account: Account }) {
  const [links, setLinks] = useState<SavedEventLink[]>([]),
    [calendars, setCalendars] = useState<CalendarSummary[]>([]),
    [form, setForm] = useState(defaults),
    [id, setId] = useState<string | undefined>(),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [slugEdited, setSlugEdited] = useState(false);
  const canManage = account.permissions.includes("manage");
  const load = async () => {
    const l = await api.eventLinks(account.id);
    setLinks(l.links);
  };
  useEffect(() => {
    if (!canManage) {
      setLoading(false);
      return;
    }
    let active = true;
    void Promise.all([
      api.eventLinks(account.id),
      api.calendars(account.id).catch(() => {
        if (active)
          setNotice(
            "Calendar access needs attention. You can still pause existing links.",
          );
        return { calendars: [] };
      }),
    ])
      .then(([l, c]) => {
        if (!active) return;
        setLinks(l.links);
        const first = l.links[0];
        if (first) {
          const { id: firstId, url: _url, ...settings } = first;
          setId(firstId);
          setForm(settings);
          setSlugEdited(true);
        }
        setCalendars(c.calendars);
        setForm((f) => ({
          ...f,
          calendarId: f.calendarId ||
            c.calendars.find((c) => c.isDefault)?.engineId ??
            c.calendars[0]?.engineId ??
            "",
        }));
      })
      .catch((e) => {
        if (active) setNotice(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [account.id, canManage]);
  const update = (patch: Partial<EventLinkSettingsData>) =>
    setForm((f) => ({ ...f, ...patch }));
  const edit = (link: SavedEventLink) => {
    const { id: linkId, url: _url, ...settings } = link;
    setId(linkId);
    setForm(settings);
    setSlugEdited(true);
    setNotice("");
  };
  const create = () => {
    setId(undefined);
    setForm({
      ...defaults(),
      calendarId:
        calendars.find((c) => c.isDefault)?.engineId ??
        calendars[0]?.engineId ??
        "",
    });
    setSlugEdited(false);
    setNotice("");
  };
  const save = async () => {
    setBusy(true);
    setNotice("");
    try {
      const saved = await api.saveEventLink(account.id, form, id);
      setId(saved.id);
      await load();
      setNotice(`Saved. Your booking link is ${saved.url}`);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Could not save event link");
    } finally {
      setBusy(false);
    }
  };
  if (!canManage)
    return (
      <div className="gsw-settings-card">
        <p>Only the mailbox owner can publish booking links.</p>
      </div>
    );
  if (loading) return <p role="status">Loading event links…</p>;
  return (
    <div className="event-link-settings" data-private>
      <section className="event-link-copy-card" aria-label="Share booking link">
        <strong>Your booking link</strong>
        <p>{links.find(link => link.id === id)?.url ?? "Save a booking link to copy and share it here."}</p>
        <button type="button" className="gsw-primary-btn" disabled={busy || !links.some(link => link.id === id)} onClick={() => {
          const url = links.find(link => link.id === id)?.url;
          if (url) void navigator.clipboard.writeText(url).then(() => setNotice("Booking link copied.")).catch(() => setNotice(`Copy this link: ${url}`));
        }}>Copy Link</button>
      </section>
      <p>
        Let guests book time with {account.address}. Calendar conflicts are
        checked across this mailbox’s calendars. Pending requests hold their
        time for up to 24 hours.
      </p>
      {notice && (
        <p role="status" className="event-link-notice">
          {notice}
        </p>
      )}
      <div className="event-link-picker">
        <label>
          Booking links
          <select
            aria-label="Choose a booking link"
            value={id ?? ""}
            disabled={busy}
            onChange={(e) => {
              const link = links.find((l) => l.id === e.target.value);
              if (link) edit(link);
              else create();
            }}
          >
            <option value="">Create a new event link</option>
            {links.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
                {!l.enabled ? " (paused)" : ""}
              </option>
            ))}
          </select>
        </label>
        <button className="gsw-secondary-btn" disabled={busy} onClick={create}>
          New link
        </button>
      </div>
      <form
        className="gsw-settings-card event-link-editor"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <fieldset disabled={busy}>
          <legend>{id ? "Edit event link" : "Create event link"}</legend>
          <div className="event-link-fields">
            <label>
              Booking name
              <input
                required
                maxLength={100}
                value={form.name}
                onChange={(e) => {
                  update({
                    name: e.target.value,
                    ...(!id && !slugEdited
                      ? {
                          slug: e.target.value
                            .toLowerCase()
                            .replace(/[^a-z0-9]+/g, "-")
                            .replace(/^-|-$/g, "")
                            .slice(0, 70),
                        }
                      : {}),
                  });
                }}
              />
            </label>
            <label>
              Link slug
              <input
                required
                minLength={3}
                maxLength={70}
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
                value={form.slug}
                onChange={(e) => {
                  setSlugEdited(true);
                  update({ slug: e.target.value });
                }}
              />
              <small>
                mail.guidedstepswellness.com/book/{form.slug || "your-link"}
              </small>
            </label>
            <label>
              Calendar
              <select
                required
                value={form.calendarId}
                onChange={(e) => update({ calendarId: e.target.value })}
              >
                <option value="">Choose a calendar</option>
                {form.calendarId &&
                  !calendars.some((c) => c.engineId === form.calendarId) && (
                    <option value={form.calendarId}>
                      Saved calendar — reconnect to change
                    </option>
                  )}
                {calendars.map((c) => (
                  <option key={c.engineId} value={c.engineId}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Schedule timezone
              <input
                required
                value={form.timeZone}
                onChange={(e) => update({ timeZone: e.target.value })}
                placeholder="America/Detroit"
              />
            </label>
            <label>
              Availability type
              <select
                value={form.mode}
                onChange={(e) =>
                  update({ mode: e.target.value as "fixed" | "windows" })
                }
              >
                <option value="fixed">Publish exact meeting times</option>
                <option value="windows">
                  Availability windows — guests choose duration
                </option>
              </select>
            </label>
            {form.mode === "fixed" ? (
              <label>
                Meeting duration
                <select
                  value={form.duration}
                  onChange={(e) => update({ duration: Number(e.target.value) })}
                >
                  {meetingDurations.map((n) => (
                    <option key={n} value={n}>
                      {minutes(n)}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <fieldset className="event-link-durations">
                <legend>Durations guests may book</legend>
                {meetingDurations.map((n) => (
                  <label key={n}>
                    <input
                      type="checkbox"
                      checked={form.allowedDurations.includes(n)}
                      onChange={(e) =>
                        update({
                          allowedDurations: e.target.checked
                            ? [...form.allowedDurations, n].sort(
                                (a, b) => a - b,
                              )
                            : form.allowedDurations.filter((d) => d !== n),
                        })
                      }
                    />
                    {minutes(n)}
                  </label>
                ))}
              </fieldset>
            )}
          </div>
          <section className="event-link-availability">
            <h3>
              {form.mode === "fixed"
                ? "Exact meeting slots"
                : "Weekly availability windows"}
            </h3>
            <p>
              All times use {form.timeZone}. Guests can look up to six months
              ahead.
            </p>
            {form.mode === "fixed" ? (
              <>
                {form.fixedSlots.map((slot, i) => (
                  <div className="event-link-time-row" key={i}>
                    <label>
                      Date
                      <input
                        type="date"
                        required
                        value={slot.date}
                        onChange={(e) =>
                          update({
                            fixedSlots: form.fixedSlots.map((s, j) =>
                              j === i ? { ...s, date: e.target.value } : s,
                            ),
                          })
                        }
                      />
                    </label>
                    <label>
                      Start
                      <input
                        type="time"
                        required
                        value={slot.start}
                        onChange={(e) =>
                          update({
                            fixedSlots: form.fixedSlots.map((s, j) =>
                              j === i ? { ...s, start: e.target.value } : s,
                            ),
                          })
                        }
                      />
                    </label>
                    <button
                      type="button"
                      className="gsw-link-btn"
                      aria-label={`Remove exact slot ${i + 1}`}
                      onClick={() =>
                        update({
                          fixedSlots: form.fixedSlots.filter((_, j) => i !== j),
                        })
                      }
                    >
                      Remove
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="gsw-secondary-btn"
                  onClick={() =>
                    update({
                      fixedSlots: [
                        ...form.fixedSlots,
                        { date: "", start: "09:00" },
                      ],
                    })
                  }
                >
                  Add exact slot
                </button>
              </>
            ) : (
              <>
                {form.windows.map((w, i) => (
                  <div className="event-link-time-row" key={i}>
                    <label>
                      Day
                      <select
                        value={w.day}
                        onChange={(e) =>
                          update({
                            windows: form.windows.map((s, j) =>
                              j === i
                                ? { ...s, day: Number(e.target.value) }
                                : s,
                            ),
                          })
                        }
                      >
                        {dayNames.map((day, n) => (
                          <option key={day} value={n}>
                            {day}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      From
                      <input
                        type="time"
                        required
                        value={w.start}
                        onChange={(e) =>
                          update({
                            windows: form.windows.map((s, j) =>
                              j === i ? { ...s, start: e.target.value } : s,
                            ),
                          })
                        }
                      />
                    </label>
                    <label>
                      Until
                      <input
                        type="time"
                        required
                        value={w.end}
                        onChange={(e) =>
                          update({
                            windows: form.windows.map((s, j) =>
                              j === i ? { ...s, end: e.target.value } : s,
                            ),
                          })
                        }
                      />
                    </label>
                    <button
                      type="button"
                      className="gsw-link-btn"
                      aria-label={`Remove window ${i + 1}`}
                      onClick={() =>
                        update({
                          windows: form.windows.filter((_, j) => i !== j),
                        })
                      }
                    >
                      Remove
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="gsw-secondary-btn"
                  onClick={() =>
                    update({
                      windows: [
                        ...form.windows,
                        { day: 1, start: "09:00", end: "17:00" },
                      ],
                    })
                  }
                >
                  Add window
                </button>
              </>
            )}
          </section>
          <label>
            Unavailable dates{" "}
            <small>One date per line, such as 2026-12-25</small>
            <textarea
              value={form.unavailableDates.join("\n")}
              onChange={(e) =>
                update({ unavailableDates: e.target.value.split("\n") })
              }
              onBlur={() =>
                update({
                  unavailableDates: form.unavailableDates
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
            />
          </label>
          <div className="event-link-fields">
            <label>
              Approval
              <select
                value={form.approval}
                onChange={(e) =>
                  update({ approval: e.target.value as "manual" | "auto" })
                }
              >
                <option value="manual">Always ask me to approve</option>
                <option value="auto">
                  Automatically approve available times
                </option>
              </select>
            </label>
            <label>
              Minimum advance notice (hours)
              <input
                required
                type="number"
                min={1}
                max={720}
                value={form.noticeHours}
                onChange={(e) =>
                  update({ noticeHours: Number(e.target.value) })
                }
              />
            </label>
            <label>
              Location (optional)
              <input
                maxLength={500}
                value={form.location}
                onChange={(e) => update({ location: e.target.value })}
              />
            </label>
            <label>
              Meeting URL (optional)
              <input
                type="url"
                value={form.meetingUrl}
                disabled={form.generateMeeting}
                onChange={(e) => update({ meetingUrl: e.target.value })}
                placeholder="https://…"
              />
            </label>
          </div>
          <label className="event-link-check">
            <input
              type="checkbox"
              checked={form.generateMeeting}
              onChange={(e) =>
                update({
                  generateMeeting: e.target.checked,
                  meetingUrl: e.target.checked ? "" : form.meetingUrl,
                })
              }
            />
            Generate a private video meeting for each confirmed booking (paid
            meeting access required)
          </label>
          <div className="event-link-checks">
            <label>
              <input
                type="checkbox"
                checked={form.phoneRequired}
                onChange={(e) => update({ phoneRequired: e.target.checked })}
              />
              Require phone number
            </label>
            <label>
              <input
                type="checkbox"
                checked={form.messageRequired}
                onChange={(e) => update({ messageRequired: e.target.checked })}
              />
              Require a message
            </label>
            <label>
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(e) => update({ enabled: e.target.checked })}
              />
              Booking link enabled
            </label>
          </div>
          <p>
            Name and email are always required. Saving authorizes GSW Mail to
            check availability, create calendar events, and send booking notices
            while you’re away.
          </p>
          <button className="gsw-primary-btn" type="submit">
            {busy ? "Saving…" : "Save event link"}
          </button>
          {id && (
            <a
              className="gsw-secondary-btn"
              href={links.find((l) => l.id === id)?.url ?? `/book/${form.slug}`}
              target="_blank"
              rel="noreferrer"
            >
              Open booking page
            </a>
          )}

        </fieldset>
      </form>
      <p>Approve or decline booking requests from the email sent to this mailbox. Confirmed meetings appear in your calendar.</p>
    </div>
  );
}
