import { useMemo, useState } from "react";
import { CalendarDays, Clock3, Repeat2, X } from "lucide-react";
import { browserTimeZone, supportedTimeZones, type RecurrenceFrequency, type ScheduleDraftInput, zonedDateTimeToIso } from "../../lib/scheduledSend";

interface Props {
  defaultTimeZone?: string;
  onClose: () => void;
  onSchedule: (schedule: ScheduleDraftInput) => void;
}

type Tab = "schedule" | "recurring";
type QuickChoice = "10m" | "1h" | "tomorrow" | "monday" | "custom";
type EndMode = "never" | "date" | "count";

const pad = (value: number) => String(value).padStart(2, "0");
const dateInput = (value: Date) => `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;

function nextMondayAt10() {
  const value = new Date();
  const days = (8 - value.getDay()) % 7 || 7;
  value.setDate(value.getDate() + days);
  value.setHours(10, 0, 0, 0);
  return value;
}

export function ScheduleSendModal({ defaultTimeZone, onClose, onSchedule }: Props) {
  const now = new Date();
  const initial = new Date(now.getTime() + 60 * 60_000);
  const [tab, setTab] = useState<Tab>("schedule");
  const [quick, setQuick] = useState<QuickChoice>("1h");
  const [date, setDate] = useState(dateInput(initial));
  const [hour24, setHour24] = useState(initial.getHours());
  const [minute, setMinute] = useState(Math.ceil(initial.getMinutes() / 5) * 5 % 60);
  const [use24Hour, setUse24Hour] = useState(false);
  const [timeZone, setTimeZone] = useState(defaultTimeZone || browserTimeZone());
  const [frequency, setFrequency] = useState<RecurrenceFrequency>("daily");
  const [interval, setInterval] = useState(1);
  const [endMode, setEndMode] = useState<EndMode>("never");
  const [endDate, setEndDate] = useState("");
  const [occurrences, setOccurrences] = useState(10);
  const [error, setError] = useState("");
  const zones = useMemo(supportedTimeZones, []);

  const setCustomFrom = (value: Date) => {
    setDate(dateInput(value));
    setHour24(value.getHours());
    setMinute(Math.round(value.getMinutes() / 5) * 5 % 60);
  };

  const chooseQuick = (choice: QuickChoice) => {
    setQuick(choice);
    const value = new Date();
    if (choice === "10m") value.setMinutes(value.getMinutes() + 10);
    if (choice === "1h") value.setHours(value.getHours() + 1);
    if (choice === "tomorrow") { value.setDate(value.getDate() + 1); value.setHours(10, 0, 0, 0); }
    if (choice === "monday") { setCustomFrom(nextMondayAt10()); return; }
    if (choice !== "custom") setCustomFrom(value);
  };

  const submit = () => {
    setError("");
    try {
      const scheduledFor = zonedDateTimeToIso(date, hour24, minute, timeZone);
      if (new Date(scheduledFor).getTime() <= Date.now() + 15_000) throw new Error("Choose a time in the future.");
      const recurrence = tab === "recurring" ? {
        frequency,
        interval: frequency === "weekdays" ? 1 : interval,
        ...(endMode === "date" && endDate ? { endAt: zonedDateTimeToIso(endDate, 23, 59, timeZone) } : {}),
        ...(endMode === "count" ? { maxOccurrences: occurrences } : {}),
      } : undefined;
      onSchedule({ scheduledFor, timeZone, ...(recurrence ? { recurrence } : {}) });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const hour12 = hour24 % 12 || 12;
  const meridiem = hour24 >= 12 ? "PM" : "AM";
  const setHour12 = (value: number) => setHour24((meridiem === "PM" ? value % 12 + 12 : value % 12));
  const setMeridiem = (value: "AM" | "PM") => setHour24(value === "PM" ? (hour12 % 12) + 12 : hour12 % 12);

  return <div className="gsw-schedule-backdrop" role="presentation" onMouseDown={onClose}>
    <section className="gsw-schedule-modal" role="dialog" aria-modal="true" aria-labelledby="schedule-title" onMouseDown={(event) => event.stopPropagation()}>
      <header className="gsw-schedule-header">
        <div><p className="gsw-eyebrow">Send later</p><h2 id="schedule-title">Choose when this message sends</h2></div>
        <button className="gsw-icon-btn" type="button" aria-label="Close schedule send" onClick={onClose}><X size={20} /></button>
      </header>

      <div className="gsw-schedule-tabs" role="tablist">
        <button type="button" className={tab === "schedule" ? "active" : ""} onClick={() => setTab("schedule")}><Clock3 size={16} /> Schedule</button>
        <button type="button" className={tab === "recurring" ? "active" : ""} onClick={() => setTab("recurring")}><Repeat2 size={16} /> Recurring</button>
      </div>

      {tab === "schedule" && <div className="gsw-schedule-quick">
        {([
          ["10m", "In 10 minutes"],
          ["1h", "In 1 hour"],
          ["tomorrow", "Tomorrow at 10:00 AM"],
          ["monday", "Next Monday at 10:00 AM"],
          ["custom", "Custom date and time"],
        ] as const).map(([value, label]) => <label key={value} className={quick === value ? "selected" : ""}>
          <input type="radio" name="schedule-quick" checked={quick === value} onChange={() => chooseQuick(value)} />
          <span>{label}</span>
        </label>)}
      </div>}

      {tab === "recurring" && <div className="gsw-recurring-grid">
        <label><span>Repeat</span><select value={frequency} onChange={(event) => setFrequency(event.target.value as RecurrenceFrequency)}><option value="daily">Daily</option><option value="weekdays">Every weekday</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></label>
        {frequency !== "weekdays" && <label><span>Every</span><div className="gsw-inline-field"><input type="number" min={1} max={365} value={interval} onChange={(event) => setInterval(Math.max(1, Number(event.target.value) || 1))} /><span>{frequency === "daily" ? "day(s)" : frequency === "weekly" ? "week(s)" : "month(s)"}</span></div></label>}
        <fieldset><legend>Ends</legend><label><input type="radio" checked={endMode === "never"} onChange={() => setEndMode("never")} /> No end date</label><label><input type="radio" checked={endMode === "date"} onChange={() => setEndMode("date")} /> On date</label>{endMode === "date" && <input type="date" value={endDate} min={date} onChange={(event) => setEndDate(event.target.value)} />}<label><input type="radio" checked={endMode === "count"} onChange={() => setEndMode("count")} /> After</label>{endMode === "count" && <div className="gsw-inline-field"><input type="number" min={2} max={1000} value={occurrences} onChange={(event) => setOccurrences(Math.max(2, Number(event.target.value) || 2))} /><span>occurrences</span></div>}</fieldset>
      </div>}

      <div className="gsw-schedule-custom">
        <label><span><CalendarDays size={15} /> Date</span><input type="date" value={date} min={dateInput(now)} onChange={(event) => { setQuick("custom"); setDate(event.target.value); }} /></label>
        <label><span><Clock3 size={15} /> Time</span><div className="gsw-time-fields">{use24Hour ? <input aria-label="Hour" type="number" min={0} max={23} value={hour24} onChange={(event) => setHour24(Math.min(23, Math.max(0, Number(event.target.value) || 0)))} /> : <><input aria-label="Hour" type="number" min={1} max={12} value={hour12} onChange={(event) => setHour12(Math.min(12, Math.max(1, Number(event.target.value) || 1)))} /><select aria-label="AM or PM" value={meridiem} onChange={(event) => setMeridiem(event.target.value as "AM" | "PM")}><option>AM</option><option>PM</option></select></>}<span>:</span><input aria-label="Minute" type="number" min={0} max={59} step={5} value={minute} onChange={(event) => setMinute(Math.min(59, Math.max(0, Number(event.target.value) || 0)))} /></div></label>
        <label className="gsw-timezone-field"><span>Time zone</span><select value={timeZone} onChange={(event) => setTimeZone(event.target.value)}>{zones.map((zone) => <option key={zone} value={zone}>{zone.replaceAll("_", " ")}</option>)}</select></label>
        <label className="gsw-24hour-toggle"><input type="checkbox" checked={use24Hour} onChange={(event) => setUse24Hour(event.target.checked)} /><span>Use 24-hour time</span></label>
      </div>

      {error && <p className="gsw-errors" role="alert">{error}</p>}
      <footer className="gsw-schedule-actions"><button type="button" className="gsw-secondary-btn" onClick={onClose}>Cancel</button><button type="button" className="gsw-primary-btn" onClick={submit}>{tab === "recurring" ? "Schedule recurring send" : "Schedule send"}</button></footer>
    </section>
  </div>;
}
